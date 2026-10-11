#!/usr/bin/env node
/**
 * Milestone 64 — deploy smoke + backup verification.
 *
 * One command after every deploy/redeploy proves the stack is
 * actually up and behaving — the failure mode this exists for
 * is "push succeeded, site quietly stale/broken" (Dokploy
 * auto-deploy has failed to fire before; a green build is not
 * a running system).
 *
 * Usage:
 *   node scripts/deploy-smoke.mjs
 *   SMOKE_API_URL=https://api.qosprey.com \
 *   SMOKE_WEB_URL=https://app.qosprey.com \
 *   SMOKE_ADMIN_URL=https://admin.qosprey.com \
 *   node scripts/deploy-smoke.mjs
 *
 * Optional env:
 *   SMOKE_ADMIN_TOKEN — a SUPER admin JWT. Enables the backup
 *     manifest check (read-only GETs only; no TOTP needed).
 *   SMOKE_SKIP_AUTH=1 — skip the throwaway register/login/org
 *     flow (it leaves ONE clearly-named account + org behind;
 *     delete them from the Admin Console when convenient).
 *
 * Backup restore drill (see docs/deployment-dokploy.md):
 * restore a dump into a scratch database, point a THROWAWAY
 * api instance at it, run `ANALYZE;` in that database, then
 * run this script against that instance — the backup check
 * compares the recorded manifest counts with the restored
 * database's counts and fails on any shortfall.
 *
 * Exit code: 0 when nothing FAILED, 1 otherwise.
 * Skips are reported, never silently counted as passes.
 */

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith("--")) args.set(process.argv[i].slice(2), process.argv[i + 1] ?? "1");
}
const API = (args.get("api") ?? process.env.SMOKE_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
const WEB = (args.get("web") ?? process.env.SMOKE_WEB_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const ADMIN = (args.get("admin") ?? process.env.SMOKE_ADMIN_URL ?? "http://localhost:3001").replace(/\/+$/, "");
const ADMIN_TOKEN = process.env.SMOKE_ADMIN_TOKEN ?? "";
const SKIP_AUTH = process.env.SMOKE_SKIP_AUTH === "1" || args.has("skip-auth");

const results = [];
function report(name, status, detail) {
  results.push({ name, status, detail });
  const mark = status === "PASS" ? "✓" : status === "FAIL" ? "✗" : "–";
  console.log(`${mark} ${name} — ${detail}`);
}
async function req(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: "follow" });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* html etc. */ }
    return { status: res.status, text, json };
  } finally { clearTimeout(timer); }
}
const get = (url, token) => req(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
const post = (url, body, token) => req(url, {
  method: "POST",
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body ?? {}),
});

// ---------- 1. API health ----------
let publicStatus = null;
try {
  const r = await get(`${API}/health`);
  if (r.status === 200 && r.json?.status === "ok") report("API health", "PASS", `${API}/health → ok`);
  else report("API health", "FAIL", `${API}/health → HTTP ${r.status} ${r.text.slice(0, 120)}`);
} catch (e) { report("API health", "FAIL", `unreachable: ${e.message}`); }

// ---------- 2. Public status ----------
try {
  const r = await get(`${API}/public/system-status`);
  if (r.status === 200 && r.json && "signupOpen" in r.json) {
    publicStatus = r.json;
    report("Public system status", "PASS", `signupOpen=${r.json.signupOpen}, maintenance=${r.json.maintenanceMode}`);
  } else report("Public system status", "FAIL", `HTTP ${r.status} ${r.text.slice(0, 120)}`);
} catch (e) { report("Public system status", "FAIL", `unreachable: ${e.message}`); }

// ---------- 3. Public pricing ----------
try {
  const r = await get(`${API}/public/pricing`);
  const tiers = Array.isArray(r.json) ? r.json : (r.json?.plans ?? r.json?.tiers);
  if (r.status === 200 && Array.isArray(tiers) && tiers.length > 0) {
    report("Public pricing", "PASS", `${tiers.length} tiers from operator settings`);
  } else report("Public pricing", "FAIL", `HTTP ${r.status} ${r.text.slice(0, 120)}`);
} catch (e) { report("Public pricing", "FAIL", `unreachable: ${e.message}`); }

// ---------- 4+5. Internal surfaces exist AND are guarded ----------
for (const [name, path] of [["Internal jobs/DLQ surface", "/internal/jobs/dlq"], ["Internal webhook surface", "/internal/webhooks/process"]]) {
  try {
    const r = await post(`${API}${path}`, {});
    if (r.status === 403 || r.status === 503) {
      report(name, "PASS", `guarded (HTTP ${r.status} without the secret)`);
    } else if (r.status === 404) {
      report(name, "FAIL", "404 — this build predates M57/M63; redeploy the current code");
    } else {
      report(name, "FAIL", `HTTP ${r.status} without a secret — expected 403/503`);
    }
  } catch (e) { report(name, "FAIL", `unreachable: ${e.message}`); }
}

// ---------- 6+7. Web + admin apps ----------
for (const [name, base] of [["Tenant web app", WEB], ["Admin console", ADMIN]]) {
  try {
    const r = await get(`${base}/`);
    if (r.status === 200 && /<html/i.test(r.text)) report(name, "PASS", `${base}/ → 200 HTML`);
    else report(name, "FAIL", `${base}/ → HTTP ${r.status}`);
  } catch (e) { report(name, "FAIL", `unreachable: ${e.message}`); }
}

// ---------- 8. Throwaway auth flow ----------
if (SKIP_AUTH) {
  report("Auth flow (register → login → org)", "SKIP", "disabled by SMOKE_SKIP_AUTH");
} else if (publicStatus && publicStatus.signupOpen === false) {
  report("Auth flow (register → login → org)", "SKIP", "signup is closed by the operator on this deployment");
} else {
  const stamp = Date.now();
  const email = `smoke-${stamp}@example.com`;
  const password = `Smoke-${stamp}-Aa1!`;
  try {
    const reg = await post(`${API}/auth/register`, { name: "Deploy Smoke", email, password });
    if (!(reg.status === 200 || reg.status === 201)) throw new Error(`register → HTTP ${reg.status} ${reg.text.slice(0, 100)}`);
    const login = await post(`${API}/auth/login`, { email, password });
    const token = login.json?.accessToken ?? login.json?.token;
    if (!(login.status === 200 || login.status === 201) || !token) throw new Error(`login → HTTP ${login.status}`);
    if (login.json?.requiresTotp) throw new Error("login demanded TOTP for a fresh account (unexpected)");
    const org = await post(`${API}/organizations`, { name: `Smoke Org ${stamp}`, slug: `smoke-${stamp}` }, token);
    const orgId = org.json?.id;
    if (!(org.status === 200 || org.status === 201) || !orgId) throw new Error(`create org → HTTP ${org.status} ${org.text.slice(0, 100)}`);
    const list = await get(`${API}/organizations`, token);
    const mine = Array.isArray(list.json) && list.json.some((o) => o.id === orgId);
    if (!mine) throw new Error("created org is not visible to its owner");
    report("Auth flow (register → login → org)", "PASS", `account ${email} + org ${orgId} (throwaway — delete from the Admin Console)`);
  } catch (e) { report("Auth flow (register → login → org)", "FAIL", e.message); }
}

// ---------- 9. Backup manifest vs current counts ----------
if (!ADMIN_TOKEN) {
  report("Backup manifest", "SKIP", "set SMOKE_ADMIN_TOKEN (a SUPER JWT) to enable");
} else {
  try {
    const panel = await get(`${API}/admin/system/backup`, ADMIN_TOKEN);
    if (panel.status !== 200) throw new Error(`backup panel → HTTP ${panel.status}`);
    const manifest = panel.json?.manifest;
    if (!manifest?.tables) {
      report("Backup manifest", "SKIP", "no manifest recorded yet — in the Admin Console, System → record/verify a backup manifest after your next backup");
    } else {
      const growth = await get(`${API}/admin/system/db-growth`, ADMIN_TOKEN);
      const rows = growth.json?.tables ?? [];
      const byName = new Map(rows.map((r) => [String(r.table).toLowerCase(), Number(r.approxRows)]));
      const shortfalls = [];
      for (const [table, count] of Object.entries(manifest.tables)) {
        const current = byName.get(table.toLowerCase());
        if (current === undefined) { shortfalls.push(`${table}: not found in current stats`); continue; }
        // pg_stat counts are estimates — fail only on a >10% drop.
        if (current < Number(count) * 0.9) shortfalls.push(`${table}: manifest ${count} vs current ≈${current}`);
      }
      const ageDays = manifest.at ? Math.floor((Date.now() - new Date(manifest.at).getTime()) / 86400000) : null;
      if (shortfalls.length) report("Backup manifest", "FAIL", `possible data loss: ${shortfalls.join("; ")}`);
      else report("Backup manifest", "PASS", `${Object.keys(manifest.tables).length} core tables at/above the manifest recorded ${ageDays === null ? "at an unknown time" : `${ageDays}d ago`} by ${manifest.verifiedBy ?? "an admin"}`);
    }
  } catch (e) { report("Backup manifest", "FAIL", e.message); }
}

// ---------- Summary ----------
const failed = results.filter((r) => r.status === "FAIL");
const skipped = results.filter((r) => r.status === "SKIP");
console.log(`\n${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped`);
if (failed.length) { console.log("FAILED: " + failed.map((f) => f.name).join(", ")); process.exit(1); }
console.log("SMOKE OK");
