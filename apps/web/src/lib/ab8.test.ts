import { describe, expect, it } from "vitest";
import {
  auditLogTotalPages,
  auditMetadataSummary,
  auditMetadataText,
  buildAuditLogQuery,
  canDownloadExport,
  dataExportKindLabel,
  dataExportStatusLabel,
  dataExportsFromPayload,
  exportDownloadFilename,
  formatExportSize,
  formatMerchantKeyPrefix,
  merchantKeysFromPayload,
  merchantApiKeyStatusLabel,
  merchantApiScopeLabel,
  validateMerchantKeyDraft,
} from "./ab8";

describe("merchant API keys (AX21)", () => {
  it("formats a stored key as qk_live_<prefix>… only", () => {
    expect(formatMerchantKeyPrefix("abcd1234")).toBe("qk_live_abcd1234…");
    expect(formatMerchantKeyPrefix("  abcd1234 ")).toBe("qk_live_abcd1234…");
    expect(formatMerchantKeyPrefix("")).toBe("—");
    expect(formatMerchantKeyPrefix(null)).toBe("—");
    expect(formatMerchantKeyPrefix(undefined)).toBe("—");
  });

  it("labels every scope in the fixed vocabulary and passes unknowns through", () => {
    for (const s of ["products:read", "products:write", "orders:read", "customers:read"]) {
      expect(merchantApiScopeLabel(s)).not.toBe(s);
      expect(merchantApiScopeLabel(s)).toContain(s);
    }
    expect(merchantApiScopeLabel("something:else")).toBe("something:else");
  });

  it("labels key statuses", () => {
    expect(merchantApiKeyStatusLabel("active")).toBe("সক্রিয়");
    expect(merchantApiKeyStatusLabel("revoked")).toBe("বাতিল করা");
    expect(merchantApiKeyStatusLabel("weird")).toBe("weird");
  });

  it("validates the create draft", () => {
    expect(validateMerchantKeyDraft("  ", ["products:read"])).not.toBeNull();
    expect(validateMerchantKeyDraft("শপ কী", [])).not.toBeNull();
    expect(validateMerchantKeyDraft("শপ কী", ["orders:delete"])).not.toBeNull();
    expect(validateMerchantKeyDraft("শপ কী", ["products:read", "orders:read"])).toBeNull();
    // The create DTO caps the name at 80 chars.
    expect(validateMerchantKeyDraft("ক".repeat(81), ["products:read"])).not.toBeNull();
    expect(validateMerchantKeyDraft("ক".repeat(80), ["products:read"])).toBeNull();
  });

  it("normalizes the key-list payload in BOTH the contract and delivered shapes", () => {
    const row = { id: "k1", name: "শপ কী", keyPrefix: "abcd1234", scopes: ["products:read"], status: "active", lastUsedAt: null, createdAt: "2026-10-16T00:00:00Z", createdById: "u1" };
    expect(merchantKeysFromPayload({ items: [row] })).toEqual([row]); // contract: { items }
    expect(merchantKeysFromPayload([row])).toEqual([row]); // delivered API: bare array
    expect(merchantKeysFromPayload(null)).toEqual([]);
    expect(merchantKeysFromPayload({})).toEqual([]);
    expect(merchantKeysFromPayload("nope")).toEqual([]);
  });
});

describe("data exports (AX25)", () => {
  it("labels kinds and statuses, passing unknowns through", () => {
    expect(dataExportKindLabel("manual")).toBe("ম্যানুয়াল");
    expect(dataExportKindLabel("backup")).toBe("স্বয়ংক্রিয় ব্যাকআপ");
    expect(dataExportKindLabel("other")).toBe("other");
    for (const s of ["pending", "ready", "failed", "expired"]) {
      expect(dataExportStatusLabel(s)).not.toBe(s);
    }
    expect(dataExportStatusLabel("other")).toBe("other");
  });

  it("offers a download only for ready exports", () => {
    expect(canDownloadExport({ status: "ready" })).toBe(true);
    expect(canDownloadExport({ status: "pending" })).toBe(false);
    expect(canDownloadExport({ status: "failed" })).toBe(false);
    expect(canDownloadExport({ status: "expired" })).toBe(false);
    expect(canDownloadExport(null)).toBe(false);
  });

  it("normalizes the exports payload in BOTH the contract and delivered shapes", () => {
    const row = { id: "e1", kind: "manual", status: "ready", sizeBytes: 10, expiresAt: null, createdAt: "2026-10-16T00:00:00Z" };
    const pref = { enabled: true, lastBackupAt: "2026-10-10T00:00:00Z" };
    expect(dataExportsFromPayload({ items: [row], backupPreference: pref })).toEqual({ items: [row], backupPreference: pref }); // contract
    expect(dataExportsFromPayload({ exports: [row], backupPreference: pref })).toEqual({ items: [row], backupPreference: pref }); // delivered API
    expect(dataExportsFromPayload(null)).toEqual({ items: [], backupPreference: { enabled: false, lastBackupAt: null } });
    expect(dataExportsFromPayload({ exports: [row] }).backupPreference).toEqual({ enabled: false, lastBackupAt: null });
  });

  it("names downloads .json — the endpoint streams JSON, not a zip", () => {
    expect(exportDownloadFilename("e1")).toBe("data-export-e1.json");
  });

  it("formats sizes honestly — null is a dash, never 0", () => {
    expect(formatExportSize(null)).toBe("—");
    expect(formatExportSize(undefined)).toBe("—");
    expect(formatExportSize(0)).toBe("০ বাইট");
    expect(formatExportSize(512)).toContain("বাইট");
    expect(formatExportSize(2048)).toContain("KB");
    expect(formatExportSize(5 * 1024 * 1024)).toContain("MB");
  });
});

describe("audit logs (AX25)", () => {
  it("builds the query, omitting empty filters", () => {
    const q = buildAuditLogQuery({ entity: "", actorId: "", from: "", to: "", page: 1, pageSize: 20 });
    expect(q).toBe("page=1&pageSize=20");
    const full = buildAuditLogQuery({
      entity: " order ", actorId: " u-1 ", from: "2026-10-01", to: "2026-10-16", page: 3, pageSize: 50,
    });
    const params = new URLSearchParams(full);
    expect(params.get("entity")).toBe("order");
    expect(params.get("actorId")).toBe("u-1");
    expect(params.get("from")).toBe("2026-10-01");
    expect(params.get("to")).toBe("2026-10-16");
    expect(params.get("page")).toBe("3");
    expect(params.get("pageSize")).toBe("50");
  });

  it("computes total pages with a floor of 1", () => {
    expect(auditLogTotalPages(0, 20)).toBe(1);
    expect(auditLogTotalPages(21, 20)).toBe(2);
    expect(auditLogTotalPages(40, 20)).toBe(2);
  });

  it("renders metadata as inert text — markup stays verbatim, never parsed", () => {
    expect(auditMetadataText(null)).toBe("—");
    expect(auditMetadataText(undefined)).toBe("—");
    expect(auditMetadataText("plain")).toBe("plain");
    const xss = auditMetadataText({ note: "<script>alert(1)</script>" });
    expect(xss).toContain("<script>alert(1)</script>");
    expect(auditMetadataText({ a: 1 })).toBe('{\n  "a": 1\n}');
    // Circular structures degrade to the placeholder instead of throwing.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(auditMetadataText(circular)).toBe("—");
  });

  it("summarizes metadata on one line with truncation", () => {
    expect(auditMetadataSummary(null)).toBe("—");
    expect(auditMetadataSummary({ a: 1 })).toBe('{ "a": 1 }');
    const long = auditMetadataSummary({ blob: "x".repeat(300) });
    expect(long.length).toBeLessThanOrEqual(161);
    expect(long.endsWith("…")).toBe(true);
  });
});
