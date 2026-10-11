import { LeaderClaim } from "./leader-claim";

/**
 * Milestone 62: the cross-instance leader claim. A fake Redis
 * implements SET NX EX semantics over a shared map so two
 * LeaderClaim instances behave like two API replicas.
 */
function fakeRedisFactory(shared: Map<string, string>) {
  return async () => ({
    set: async (key: string, value: string, _ex: string, _ttl: number, nx: string) => {
      if (nx === "NX" && shared.has(key)) return null;
      shared.set(key, value);
      return "OK";
    },
  });
}

describe("M62 leader claim", () => {
  it("without REDIS_URL the claim always succeeds (single instance)", async () => {
    delete process.env.REDIS_URL;
    const claim = new LeaderClaim();
    await expect(claim.tryClaim("rule-evaluation", 3600)).resolves.toBe(true);
    await expect(claim.tryClaim("rule-evaluation", 3600)).resolves.toBe(true);
  });

  it("two instances over one Redis: exactly one wins the round", async () => {
    const shared = new Map<string, string>();
    const a = new LeaderClaim(fakeRedisFactory(shared));
    const b = new LeaderClaim(fakeRedisFactory(shared));
    const [ra, rb] = [await a.tryClaim("rule-evaluation", 3600), await b.tryClaim("rule-evaluation", 3600)];
    expect([ra, rb].filter(Boolean)).toHaveLength(1);
    // A different key is an independent claim.
    await expect(b.tryClaim("workflow-scan", 270)).resolves.toBe(true);
  });

  it("a failing Redis yields NO claim (skip the round, never double-fire)", async () => {
    const claim = new LeaderClaim(async () => { throw new Error("redis down"); });
    await expect(claim.tryClaim("rule-evaluation", 3600)).resolves.toBe(false);
    // And it stays failed-fast instead of throwing into the tick.
    await expect(claim.tryClaim("rule-evaluation", 3600)).resolves.toBe(false);
  });
});
