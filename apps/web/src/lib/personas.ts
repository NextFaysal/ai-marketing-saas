/**
 * AP7 personas — web mirror of the API registry (apps/api
 * src/ai/personas.ts). The server enforces the tool scoping; this
 * list only drives the picker UI and labels.
 */
export interface PersonaUi {
  id: string;
  labelBn: string;
  icon: string;
}

export const PERSONAS_UI: PersonaUi[] = [
  { id: "general", labelBn: "সাধারণ সহকারী", icon: "✦" },
  { id: "ads_analyst", labelBn: "Ads Analyst", icon: "📣" },
  { id: "inbox_coach", labelBn: "Inbox Coach", icon: "💬" },
  { id: "finance_analyst", labelBn: "Finance Analyst", icon: "💰" },
];

export function personaLabel(id: string | null | undefined): string {
  return PERSONAS_UI.find((p) => p.id === id)?.labelBn ?? "সাধারণ সহকারী";
}
