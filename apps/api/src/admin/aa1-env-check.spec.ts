process.env.ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Reflector } from "@nestjs/core";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { ADMIN_TIER_KEY } from "../common/super-admin.guard";

/**
 * Admin Advanced AA1 — Deploy Readiness Checklist.
 *
 * The contract under test: PRESENCE ONLY. Env values are never
 * read into the response — proven by seeding canary values and
 * scanning the serialized payload for them. The compose group
 * is reported as unverifiable (never a guessed present/absent).
 */

const audit = { log: async () => undefined } as any;

const ENV_KEYS = [
  "DATABASE_URL", "JWT_SECRET", "ENCRYPTION_KEY", "INTERNAL_JOB_SECRET",
  "REDIS_URL", "API_PUBLIC_URL", "PUBLIC_API_URL", "WEB_URL",
  "WORKER_HEALTH_URL", "ADMIN_IP_ALLOWLIST", "PRISMA_MIGRATIONS_DIR",
];
let savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function svcWithMigrations(applied: { migration_name: string }[]) {
  const prisma: any = {
    systemSetting: { findUnique: async () => null },
    $queryRawUnsafe: async () => applied,
  };
  return new AdminService(prisma, audit);
}

describe("AA1 — systemEnvCheck", () => {
  it("reports presence for required + optional vars and never leaks a canary value", async () => {
    const CANARY = "canary-value-aa1-do-not-leak";
    process.env.DATABASE_URL = `postgres://u:${CANARY}@db:5432/x`;
    process.env.JWT_SECRET = CANARY;
    process.env.ENCRYPTION_KEY = CANARY;
    process.env.INTERNAL_JOB_SECRET = CANARY;
    process.env.REDIS_URL = `redis://:${CANARY}@redis:6379`;
    // API_PUBLIC_URL etc. left unset on purpose.
    const out: any = await svcWithMigrations([]).systemEnvCheck();

    const byName = new Map<string, any>(out.apiEnv.map((e: any) => [e.name, e]));
    for (const name of ["DATABASE_URL", "JWT_SECRET", "ENCRYPTION_KEY", "INTERNAL_JOB_SECRET"]) {
      expect(byName.get(name)).toMatchObject({ required: true, present: true });
      expect(typeof byName.get(name).hintBn).toBe("string");
    }
    expect(byName.get("REDIS_URL")).toMatchObject({ required: false, present: true });
    expect(byName.get("API_PUBLIC_URL")).toMatchObject({ required: false, present: false });
    expect(out.summary).toEqual({ requiredTotal: 4, requiredPresent: 4, requiredMissing: 0, ready: true });
    // The canary scan: no env VALUE anywhere in the payload.
    expect(JSON.stringify(out)).not.toContain(CANARY);
  });

  it("flags every missing required var and reports not-ready", async () => {
    const out: any = await svcWithMigrations([]).systemEnvCheck();
    expect(out.summary).toEqual({ requiredTotal: 4, requiredPresent: 0, requiredMissing: 4, ready: false });
    expect(out.apiEnv.filter((e: any) => e.required).every((e: any) => e.present === false)).toBe(true);
  });

  it("compose-level vars are unverifiable — no present/absent is ever claimed for them", async () => {
    process.env.POSTGRES_PASSWORD = "should-not-matter";
    process.env.APP_DOMAIN = "app.example.com";
    const out: any = await svcWithMigrations([]).systemEnvCheck();
    expect(out.composeEnv.map((e: any) => e.name)).toEqual(["POSTGRES_PASSWORD", "APP_DOMAIN"]);
    for (const e of out.composeEnv) {
      expect(e.verifiable).toBe(false);
      expect("present" in e).toBe(false);
    }
    expect(JSON.stringify(out)).not.toContain("should-not-matter");
    expect(JSON.stringify(out)).not.toContain("app.example.com");
  });

  it("computes pending migrations from the repo dir vs the DB ledger", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aa1-migrations-"));
    try {
      for (const n of ["20260101000000_a", "20260202000000_b", "20260303000000_c"]) mkdirSync(join(dir, n));
      mkdirSync(join(dir, "not-a-migration"));
      process.env.PRISMA_MIGRATIONS_DIR = dir;
      const out: any = await svcWithMigrations([
        { migration_name: "20260101000000_a" },
        { migration_name: "20260202000000_b" },
      ]).systemEnvCheck();
      expect(out.migrations.applied).toBe(2);
      expect(out.migrations.latest).toBe("20260101000000_a"); // finished_at DESC order from the query
      expect(out.migrations.repoTotal).toBe(3);
      expect(out.migrations.pending).toBe(1);
      expect(out.migrations.pendingNames).toEqual(["20260303000000_c"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves pending unknown (null) when the migrations dir cannot be read", async () => {
    process.env.PRISMA_MIGRATIONS_DIR = "/nonexistent-aa1/migrations";
    const out: any = await svcWithMigrations([{ migration_name: "20260101000000_a" }]).systemEnvCheck();
    expect(out.migrations.applied).toBe(1);
    expect(out.migrations.repoTotal).toBeNull();
    expect(out.migrations.pending).toBeNull();
  });

  it("includes the platform-config source summary (no secrets) for all 10 blocks", async () => {
    const out: any = await svcWithMigrations([]).systemEnvCheck();
    expect(out.platformConfig.map((a: any) => a.area)).toEqual([
      "llm", "metaApp", "smtp", "sms", "sslcommerz", "bkash", "image", "tiktokApp", "googleApp", "linkedinApp",
    ]);
    expect(out.platformConfig.every((a: any) => ["admin", "env", "none"].includes(a.source))).toBe(true);
  });

  it("env-check route follows the system neighbours: SuperAdminGuard default (no tier restriction)", () => {
    const reflector = new Reflector();
    // Read endpoints in the system group carry no @AdminTier —
    // the guard admits any admin tier for reads. AA1 matches.
    expect(reflector.get(ADMIN_TIER_KEY, AdminController.prototype.systemEnvCheck)).toBeUndefined();
    expect(reflector.get(ADMIN_TIER_KEY, AdminController.prototype.systemVersion)).toBeUndefined();
  });

  it("controller delegates to the service", async () => {
    const marker = { summary: { ready: true } };
    const ctrl = new AdminController({ systemEnvCheck: async () => marker } as any, {} as any, {} as any, {} as any);
    await expect(ctrl.systemEnvCheck()).resolves.toBe(marker);
  });
});
