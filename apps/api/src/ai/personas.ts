/**
 * AP7 specialist personas. A persona is a named assistant mode on
 * a conversation: it (a) adds a focus paragraph to the system
 * prompt (steering only — the grounded rules always win) and
 * (b) SCOPES which tool modules may execute, enforced server-side
 * in ChatService next to the RBAC gate. Personas never widen
 * access: they only narrow the general tool universe.
 */

export interface PersonaDef {
  id: string;
  labelBn: string;
  labelEn: string;
  /** Tool modules in scope; null = every module (the general assistant). */
  modules: readonly string[] | null;
  focus: string;
  startersBn: string[];
}

export const PERSONAS: readonly PersonaDef[] = [
  {
    id: "general",
    labelBn: "সাধারণ সহকারী",
    labelEn: "General Assistant",
    modules: null,
    focus: "",
    startersBn: [],
  },
  {
    id: "ads_analyst",
    labelBn: "Ads Analyst",
    labelEn: "Ads Analyst",
    modules: ["ads", "analytics", "competitors", "catalog"],
    focus:
      "Persona focus: you are acting as an advertising analyst. Prioritise campaign and ad-set performance, attribution, competitor ads and the catalogue facts behind them. When a question needs data outside advertising (inbox, team, CRM), say plainly that this persona does not cover it and suggest switching to the General Assistant.",
    startersBn: ["সেরা ক্যাম্পেইন কোনটি?", "কোন বিজ্ঞাপনে CPA সবচেয়ে কম?", "প্রতিযোগীরা কী বিজ্ঞাপন চালাচ্ছে?"],
  },
  {
    id: "inbox_coach",
    labelBn: "Inbox Coach",
    labelEn: "Inbox Coach",
    modules: ["inbox", "crm", "customers", "knowledge", "orders"],
    focus:
      "Persona focus: you are acting as an inbox and customer-care coach. Prioritise inbox performance, unanswered questions, leads, customer history and business knowledge. When a question needs advertising or finance data, say plainly that this persona does not cover it and suggest switching to the General Assistant.",
    startersBn: ["কোন প্রশ্নের উত্তর বাকি আছে?", "লিড পাইপলাইন কেমন?", "ইনবক্সের অবস্থা কেমন?"],
  },
  {
    id: "finance_analyst",
    labelBn: "Finance Analyst",
    labelEn: "Finance Analyst",
    modules: ["analytics", "billing", "courier", "orders", "catalog"],
    focus:
      "Persona focus: you are acting as a finance analyst. Prioritise revenue, profit, forecasts, AI usage, courier COD and order economics. Label every estimate with its method; never present a forecast as a fact. When a question needs advertising or inbox detail, say plainly that this persona does not cover it and suggest switching to the General Assistant.",
    startersBn: ["আগামী ১৪ দিনের বিক্রির পূর্বাভাস দাও", "এই মাসে লাভ কেমন?", "COD কত সংগ্রহ হয়েছে?"],
  },
] as const;

export const PERSONA_IDS = PERSONAS.map((p) => p.id) as readonly string[];

export function personaById(id: string | null | undefined): PersonaDef {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0];
}

/** Is this tool module inside the persona's scope? */
export function personaAllowsModule(personaId: string | null | undefined, module: string): boolean {
  const def = personaById(personaId);
  if (!def.modules) return true;
  return def.modules.includes(module);
}
