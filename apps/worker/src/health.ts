import { createServer, type Server } from "node:http";

/**
 * Worker Completion WK2: the worker's health surface.
 * Dokploy/Docker can only restart what they can observe —
 * until now a hung worker looked exactly like a live one.
 * GET /health → 200 {status:"ok", ...} or 503
 * {status:"degraded", ...} when Redis does not answer.
 */
export interface HealthDeps {
  ping: () => Promise<string>;
  queues: string[];
  secretConfigured: boolean;
  startedAt: number;
}

export async function healthSnapshot(deps: HealthDeps): Promise<{ status: "ok" | "degraded"; httpCode: 200 | 503; body: Record<string, unknown> }> {
  let redis: "ok" | "error" = "ok";
  try {
    const pong = await deps.ping();
    if (pong !== "PONG") redis = "error";
  } catch { redis = "error"; }
  const status = redis === "ok" ? "ok" : "degraded";
  return {
    status,
    httpCode: status === "ok" ? 200 : 503,
    body: {
      status,
      service: "worker",
      queues: deps.queues,
      redis,
      secretConfigured: deps.secretConfigured,
      uptimeSec: Math.floor((Date.now() - deps.startedAt) / 1000),
    },
  };
}

export function startHealthServer(port: number, deps: HealthDeps): Server {
  const server = createServer(async (req, res) => {
    if (req.url === "/health" && (req.method === "GET" || req.method === "HEAD")) {
      const snap = await healthSnapshot(deps);
      res.writeHead(snap.httpCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify(snap.body));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "not_found" }));
  });
  server.listen(port, () => console.log(`[worker] health endpoint on :${port}/health`));
  return server;
}
