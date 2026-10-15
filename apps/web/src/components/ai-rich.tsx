"use client";
import React from "react";

/**
 * A2 rich answers (AP1) — deterministic rendering of the STORED tool
 * results that an assistant answer was grounded in.
 *
 * Hard rule: nothing is rendered that is not in the `display` payload
 * of a tool-call summary entry (the compact projection the API stores
 * on the message). No number is computed from anything else, no field
 * is invented, and unknown tools / missing displays render nothing —
 * the Markdown text + transparency card remain the fallback.
 * Purely presentational: `buildRichBlocks` does the mapping, the
 * component only paints the blocks.
 */

export interface AiToolCallEntry {
  tool: string;
  status?: string;
  display?: unknown;
}

export type RichBlock =
  | { kind: "stats"; tool: string; tiles: { label: string; value: string }[] }
  | { kind: "deltas"; tool: string; tiles: { label: string; current: string; previous: string; deltaPercent: number | null }[] }
  | { kind: "bars"; tool: string; rows: { label: string; value: string; widthPercent: number }[] }
  | { kind: "table"; tool: string; columns: string[]; rows: string[][] };

/** Tool-call entries that are real tools (internal "__*" markers are not). */
export function visibleToolCalls<T extends { tool: string }>(toolCalls: readonly T[] | null | undefined): T[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.filter((t) => typeof t?.tool === "string" && !t.tool.startsWith("__"));
}

/** True when the message was a stopped partial (trailing __stopped marker). */
export function hasStoppedMarker(toolCalls: readonly { tool: string }[] | null | undefined): boolean {
  return Array.isArray(toolCalls) && toolCalls.some((t) => t?.tool === "__stopped");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function present(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

/** Display a supplied scalar exactly as supplied (numbers/strings only). */
function fmtScalar(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim() !== "") return v;
  return null;
}

/**
 * The numeric magnitude of a supplied value, for bar widths only:
 * a number as-is, or the first number inside a supplied formatted
 * string (e.g. "BDT 84,000.00"). Never invents a value.
 */
function numericValue(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = v.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    if (m) {
      const n = Number(m[0]);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

const OVERVIEW_FIELDS: { key: string; label: string; percent?: boolean }[] = [
  { key: "orders", label: "অর্ডার" },
  { key: "revenue", label: "Revenue" },
  { key: "adSpend", label: "Ad Spend" },
  { key: "averageOrderValue", label: "গড় অর্ডার মূল্য" },
  { key: "contributionProfit", label: "Contribution Profit" },
  { key: "contributionMarginPercent", label: "Margin", percent: true },
  { key: "mer", label: "MER" },
  { key: "platformRoas", label: "Platform ROAS" },
  { key: "cogsCoveragePercent", label: "COGS Coverage", percent: true },
  { key: "platformConversions", label: "Platform Conversions" },
];

function overviewBlock(display: Record<string, unknown>): RichBlock | null {
  const tiles: { label: string; value: string }[] = [];
  for (const f of OVERVIEW_FIELDS) {
    const raw = display[f.key];
    const text = fmtScalar(raw);
    if (!present(raw) || text === null) continue;
    tiles.push({ label: f.label, value: f.percent && typeof raw === "number" ? `${text}%` : text });
  }
  return tiles.length ? { kind: "stats", tool: "get_analytics_overview", tiles } : null;
}

const COMPARE_FIELDS: { key: string; label: string }[] = [
  { key: "orders", label: "অর্ডার" },
  { key: "revenue", label: "Revenue" },
  { key: "adSpend", label: "Ad Spend" },
  { key: "contributionProfit", label: "Profit" },
];

function compareBlock(display: Record<string, unknown>): RichBlock | null {
  if (!isRecord(display.current) || !isRecord(display.previous)) return null;
  const deltas = isRecord(display.deltasPercent) ? display.deltasPercent : {};
  const tiles: { label: string; current: string; previous: string; deltaPercent: number | null }[] = [];
  for (const f of COMPARE_FIELDS) {
    const cur = fmtScalar(display.current[f.key]);
    const prev = fmtScalar(display.previous[f.key]);
    if (cur === null && prev === null) continue;
    const d = deltas[f.key];
    tiles.push({
      label: f.label,
      current: cur ?? "—",
      previous: prev ?? "—",
      deltaPercent: typeof d === "number" && Number.isFinite(d) ? d : null,
    });
  }
  return tiles.length ? { kind: "deltas", tool: "compare_periods", tiles } : null;
}

function barRows(
  items: unknown,
  pick: (item: Record<string, unknown>) => { label: string | null; valueText: string | null; numeric: number | null },
): { label: string; value: string; widthPercent: number }[] {
  if (!Array.isArray(items)) return [];
  const picked: { label: string; value: string; numeric: number }[] = [];
  for (const raw of items) {
    if (!isRecord(raw)) continue;
    const p = pick(raw);
    if (p.label === null || p.valueText === null || p.numeric === null) continue;
    picked.push({ label: p.label, value: p.valueText, numeric: p.numeric });
  }
  const max = picked.reduce((m, r) => Math.max(m, r.numeric), 0);
  return picked.map((r) => ({
    label: r.label,
    value: r.value,
    widthPercent: max > 0 ? Math.round((r.numeric / max) * 1000) / 10 : 0,
  }));
}

function campaignsBlock(display: Record<string, unknown>): RichBlock | null {
  const rows = barRows(display.campaigns, (c) => {
    const label = fmtScalar(c.name);
    const spendText = fmtScalar(c.spend);
    const spendNum = numericValue(c.spend);
    if (spendText !== null && spendNum !== null) return { label, valueText: spendText, numeric: spendNum };
    const clicks = numericValue(c.clicks);
    const clicksText = fmtScalar(c.clicks);
    return { label, valueText: clicksText !== null ? `Clicks ${clicksText}` : null, numeric: clicks };
  });
  return rows.length ? { kind: "bars", tool: "get_campaign_performance", rows } : null;
}

function productProfitBlock(display: Record<string, unknown>): RichBlock | null {
  const rows = barRows(display.products, (p) => {
    const label = fmtScalar(p.name);
    const profitText = fmtScalar(p.grossProfit);
    if (profitText !== null) return { label, valueText: profitText, numeric: numericValue(p.grossProfit) };
    const revText = fmtScalar(p.revenue);
    return { label, valueText: revText, numeric: numericValue(p.revenue) };
  });
  return rows.length ? { kind: "bars", tool: "get_product_profit", rows } : null;
}

function courierBlock(display: Record<string, unknown>): RichBlock | null {
  const rows = barRows(display.providers, (p) => {
    const label = fmtScalar(p.provider);
    const totalText = fmtScalar(p.total);
    if (totalText !== null) return { label, valueText: `${totalText}টি শিপমেন্ট`, numeric: numericValue(p.total) };
    const deliveredText = fmtScalar(p.delivered);
    return { label, valueText: deliveredText !== null ? `${deliveredText}টি ডেলিভারি` : null, numeric: numericValue(p.delivered) };
  });
  return rows.length ? { kind: "bars", tool: "get_courier_performance", rows } : null;
}

const PRODUCT_COLUMNS: { key: string; label: string }[] = [
  { key: "name", label: "নাম" },
  { key: "sku", label: "SKU" },
  { key: "price", label: "দাম" },
  { key: "stock", label: "স্টক" },
];

function productsBlock(display: Record<string, unknown>): RichBlock | null {
  if (!Array.isArray(display.products)) return null;
  const items = display.products.filter(isRecord);
  if (items.length === 0) return null;
  // Only columns that at least one supplied row actually carries.
  const columns = PRODUCT_COLUMNS.filter((c) => items.some((p) => present(p[c.key]) && fmtScalar(p[c.key]) !== null));
  if (columns.length === 0) return null;
  const rows = items.map((p) => columns.map((c) => fmtScalar(p[c.key]) ?? "—"));
  return { kind: "table", tool: "list_products", columns: columns.map((c) => c.label), rows };
}

/** Map stored tool-call summaries to rich blocks. Unknown tools,
 *  missing displays, error entries and "__*" markers yield nothing. */
export function buildRichBlocks(toolCalls: readonly AiToolCallEntry[] | null | undefined): RichBlock[] {
  const blocks: RichBlock[] = [];
  for (const entry of visibleToolCalls(toolCalls ?? [])) {
    if (entry.status && entry.status !== "success") continue;
    if (!isRecord(entry.display)) continue;
    let block: RichBlock | null = null;
    switch (entry.tool) {
      case "get_analytics_overview": block = overviewBlock(entry.display); break;
      case "compare_periods": block = compareBlock(entry.display); break;
      case "get_campaign_performance": block = campaignsBlock(entry.display); break;
      case "get_product_profit": block = productProfitBlock(entry.display); break;
      case "get_courier_performance": block = courierBlock(entry.display); break;
      case "list_products": block = productsBlock(entry.display); break;
      default: block = null;
    }
    if (block) blocks.push(block);
  }
  return blocks;
}

/**
 * Tool transparency card (GV1/G2): which tools an answer was
 * grounded in, plus the stopped marker. Extracted from the AI page
 * (where it was a page-local function) so the page and the Global
 * Assistant panel render the identical card from one implementation.
 * Renders nothing when there are no visible tools and no stop marker.
 */
/**
 * AP2: the attachment chip on a user bubble — shows the attached
 * file's name and, expandable, the exact extracted text / vision
 * description the assistant was given (it is stored on the
 * message, so this stays truthful after a reload).
 */
export function AiMessageAttachment({ name, kind, text }: { name: string; kind: string; text?: string | null }) {
  return (
    <details className="ai-attach">
      <summary className="ai-attach-summary">
        <span aria-hidden="true">{kind === "image" ? "🖼️" : "📎"}</span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {kind === "image" ? <span className="badge badge-slate">AI বর্ণনা</span> : null}
      </summary>
      {text ? <pre className="ai-attach-text">{text}</pre> : null}
    </details>
  );
}

export function AiToolTransparency({ toolCalls }: { toolCalls?: readonly { tool: string; status?: string }[] | null }) {
  const visible = visibleToolCalls(toolCalls);
  const stopped = hasStoppedMarker(toolCalls);
  if (visible.length === 0 && !stopped) return null;
  return (
    <div className="ai-tool-card">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">ব্যবহৃত টুল</span>
      {visible.map((t, i) => (
        <span key={`${t.tool}-${i}`} className="ai-tool-chip">
          {t.tool}
          <span className={`ai-tool-status ${t.status === "success" ? "ai-tool-status-ok" : "ai-tool-status-err"}`}>{t.status}</span>
        </span>
      ))}
      {stopped ? <span className="ai-tool-chip"><span className="ai-tool-status ai-tool-status-stopped">থামানো হয়েছে</span></span> : null}
    </div>
  );
}

export function AiRichAnswer({ toolCalls }: { toolCalls?: readonly AiToolCallEntry[] | null }) {
  const blocks = buildRichBlocks(toolCalls);
  if (blocks.length === 0) return null;
  return (
    <div className="ai-rich">
      {blocks.map((b, i) => {
        if (b.kind === "stats") {
          return (
            <div key={i} className="ai-stat-grid">
              {b.tiles.map((t) => (
                <div key={t.label} className="ai-stat-tile">
                  <span className="ai-stat-label">{t.label}</span>
                  <span className="ai-stat-value">{t.value}</span>
                </div>
              ))}
            </div>
          );
        }
        if (b.kind === "deltas") {
          return (
            <div key={i} className="ai-stat-grid">
              {b.tiles.map((t) => (
                <div key={t.label} className="ai-stat-tile">
                  <span className="ai-stat-label">{t.label}</span>
                  <span className="ai-stat-value">{t.current}</span>
                  <span className="ai-stat-hint">
                    আগে: {t.previous}
                    {t.deltaPercent !== null ? (
                      <span className={t.deltaPercent >= 0 ? "ai-delta-up" : "ai-delta-down"}>
                        {" "}{t.deltaPercent >= 0 ? "▲" : "▼"} {Math.abs(t.deltaPercent)}%
                      </span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          );
        }
        if (b.kind === "bars") {
          return (
            <div key={i} className="ai-bars">
              {b.rows.map((r) => (
                <div key={r.label} className="ai-bar-row">
                  <span className="ai-bar-label">{r.label}</span>
                  <span className="ai-bar-track"><span className="ai-bar-fill" style={{ width: `${r.widthPercent}%` }} /></span>
                  <span className="ai-bar-value">{r.value}</span>
                </div>
              ))}
            </div>
          );
        }
        return (
          <div key={i} className="ai-table-wrap">
            <table className="ai-table">
              <thead>
                <tr>{b.columns.map((c) => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((row, ri) => (
                  <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
