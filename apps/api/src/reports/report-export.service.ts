import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CustomReportsService, DAY_METRICS } from "./custom-reports.service";

/**
 * Reports Advanced RP3 — exports. One computation
 * (the RP2 run), two renderings: CSV (with a BOM so
 * Excel renders Bengali labels correctly) and a
 * branded print HTML (the invoice mechanism — the
 * browser's print-to-PDF). No xlsx library exists in
 * this codebase, so nothing here pretends to be one:
 * the file is CSV and is labelled CSV.
 */
export const METRIC_LABELS: Record<string, string> = {
  orders: "Orders", revenue: "Revenue", refunds: "Refunds", cogs: "COGS", adSpend: "Ad Spend", profit: "Profit", aov: "AOV",
  spend: "Spend", impressions: "Impressions", clicks: "Clicks", conversions: "Platform Conversions",
  conversionValue: "Conversion Value (Platform)", ctr: "CTR %", cpm: "CPM", cpa: "CPA",
};
const MONEY = new Set(["revenue", "refunds", "cogs", "adSpend", "profit", "aov", "spend", "conversionValue", "cpm", "cpa"]);
const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const fmtVal = (metric: string, v: string | number | null) => {
  if (v === null || v === undefined) return "";
  if (MONEY.has(metric)) {
    const n = Number(BigInt(String(v))) / 100;
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(v);
};

export function runToCsv(run: { dimension: string; metrics: string[]; rows: { label: string; values: Record<string, string | number | null> }[]; totals: Record<string, string | number | null> }): string {
  const dimLabel = run.dimension === "day" ? "Date" : run.dimension === "platform" ? "Platform" : "Campaign";
  const lines = [[dimLabel, ...run.metrics.map((m) => METRIC_LABELS[m] ?? m)].map(esc).join(",")];
  for (const r of run.rows) lines.push([r.label, ...run.metrics.map((m) => fmtVal(m, r.values[m] ?? null))].map(esc).join(","));
  lines.push(["TOTAL", ...run.metrics.map((m) => fmtVal(m, run.totals[m] ?? null))].map(esc).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

@Injectable()
export class ReportExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly custom: CustomReportsService,
  ) {}

  async savedCsv(organizationId: string, id: string): Promise<{ filename: string; csv: string }> {
    const def = await this.custom.get(organizationId, id);
    const run = await this.custom.runSaved(organizationId, id);
    // HTTP headers are Latin-1: a Bengali report name must
    // not go raw into Content-Disposition (Node throws).
    // ASCII fallback here; the controller adds the
    // RFC 5987 filename* with the real name.
    const ascii = def.name.replace(/[^\x20-\x7E]+/g, "-").replace(/["\\]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    return { filename: `report-${ascii || "report"}.csv`, csv: runToCsv(run) };
  }

  /** RP4: email parts for scheduled delivery — the text
   *  part IS the CSV (readable anywhere), the HTML part
   *  is the same table rendered. One run, as always. */
  async savedEmailParts(organizationId: string, id: string): Promise<{ subject: string; text: string; html: string }> {
    const def = await this.custom.get(organizationId, id);
    const run = await this.custom.runSaved(organizationId, id);
    const csv = runToCsv(run).replace(/^﻿/, "");
    const head = run.metrics.map((m) => `<th style="border:1px solid #e2e8f0;padding:4px 8px;text-align:left">${METRIC_LABELS[m] ?? m}</th>`).join("");
    const body = run.rows.map((r) => `<tr><td style="border:1px solid #e2e8f0;padding:4px 8px">${escapeHtml(r.label)}</td>${run.metrics.map((m) => `<td style="border:1px solid #e2e8f0;padding:4px 8px">${escapeHtml(fmtVal(m, r.values[m] ?? null)) || "—"}</td>`).join("")}</tr>`).join("");
    const total = `<tr><td style="border:1px solid #e2e8f0;padding:4px 8px"><strong>TOTAL</strong></td>${run.metrics.map((m) => `<td style="border:1px solid #e2e8f0;padding:4px 8px"><strong>${escapeHtml(fmtVal(m, run.totals[m] ?? null)) || "—"}</strong></td>`).join("")}</tr>`;
    const html = `<div style="font-family:system-ui,sans-serif;color:#0f172a"><h2 style="font-size:16px">${escapeHtml(def.name)}</h2>`
      + `<p style="color:#64748b;font-size:12px">${run.range.from} → ${run.range.to} · সব টাকার অঙ্ক BDT</p>`
      + `<table style="border-collapse:collapse"><thead><tr><th style="border:1px solid #e2e8f0;padding:4px 8px;text-align:left">${run.dimension}</th>${head}</tr></thead><tbody>${body}${total}</tbody></table></div>`;
    return { subject: `Report: ${def.name} (${run.range.from} → ${run.range.to})`, text: `${def.name}\n${run.range.from} → ${run.range.to}\n\n${csv}`, html };
  }

  async overviewCsv(organizationId: string, from?: string, to?: string): Promise<{ filename: string; csv: string }> {
    const run = await this.custom.run(organizationId, { dimension: "day", metrics: [...DAY_METRICS], from, to, rangePreset: from && to ? undefined : "last_30d" });
    return { filename: `overview-${run.range.from}-to-${run.range.to}.csv`, csv: runToCsv(run) };
  }

  async savedPrintHtml(organizationId: string, id: string): Promise<string> {
    const def = await this.custom.get(organizationId, id);
    const run = await this.custom.runSaved(organizationId, id);
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId }, select: { name: true, brandName: true, primaryColor: true } }).catch(() => null);
    const brand = (org?.brandName ?? org?.name ?? "Report").toString();
    const color = /^#[0-9a-fA-F]{6}$/.test(org?.primaryColor ?? "") ? org.primaryColor : "#2563eb";
    const head = run.metrics.map((m) => `<th>${METRIC_LABELS[m] ?? m}</th>`).join("");
    const body = run.rows.map((r) => `<tr><td>${escapeHtml(r.label)}</td>${run.metrics.map((m) => `<td>${escapeHtml(fmtVal(m, r.values[m] ?? null)) || "—"}</td>`).join("")}</tr>`).join("");
    const total = `<tr class="total"><td>TOTAL</td>${run.metrics.map((m) => `<td>${escapeHtml(fmtVal(m, run.totals[m] ?? null)) || "—"}</td>`).join("")}</tr>`;
    return `<!doctype html><html lang="bn"><head><meta charset="utf-8"><title>${escapeHtml(def.name)} — ${escapeHtml(brand)}</title>
<style>body{font-family:system-ui,sans-serif;margin:32px;color:#0f172a}h1{font-size:20px;margin:0}.brand{color:${color};font-weight:700}.meta{color:#64748b;font-size:12px;margin:4px 0 16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left;font-size:13px}th{background:#f8fafc}.total{font-weight:700;background:#f8fafc}button{margin-bottom:16px;padding:8px 14px;background:${color};color:#fff;border:0;border-radius:8px;cursor:pointer}@media print{button{display:none}}</style></head>
<body><button onclick="window.print()">Print / PDF</button><div class="brand">${escapeHtml(brand)}</div><h1>${escapeHtml(def.name)}</h1>
<div class="meta">${run.range.from} → ${run.range.to} · Dimension: ${run.dimension} · তৈরি: ${new Date().toLocaleString()} · সব টাকার অঙ্ক BDT</div>
<table><thead><tr><th>${run.dimension === "day" ? "Date" : run.dimension === "platform" ? "Platform" : "Campaign"}</th>${head}</tr></thead><tbody>${body}${total}</tbody></table></body></html>`;
  }
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
