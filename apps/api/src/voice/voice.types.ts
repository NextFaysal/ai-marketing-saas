export type VoiceProvider = "twilio" | "mock";

export type CallStatus =
  | "initiated"
  | "ringing"
  | "in_progress"
  | "completed"
  | "busy"
  | "failed"
  | "no_answer";

export type CallOutcome =
  | "pending"
  | "confirmed"
  | "rejected"
  | "unreachable"
  | "failed";

export interface InitiateVoiceCallDto {
  phone?: string;
  provider?: VoiceProvider;
  customPrompt?: string;
}

export interface VoiceCallSettingDto {
  enabled?: boolean;
  autoCallNewCod?: boolean;
  delayMinutes?: number;
  provider?: VoiceProvider;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioCallerId?: string;
  promptIntro?: string;
  maxAttempts?: number;
  retryIntervalMinutes?: number;
}

export interface SimulateCallReplyDto {
  digitsPressed: "1" | "2" | "none";
}

/**
 * Builds standard, professional Bengali prompt for COD order confirmation.
 */
export function buildBanglaVoicePrompt(params: {
  customerName?: string | null;
  brandName?: string | null;
  itemsSummary?: string | null;
  totalFormatted?: string | null;
  customIntro?: string | null;
}): string {
  const intro = params.customIntro ? `${params.customIntro.trim()} ` : "আসসালামু আলাইকুম। ";
  const customerPart = params.customerName ? `${params.customerName}। ` : "";
  const brand = params.brandName?.trim() || "আমাদের শপ";
  const items = params.itemsSummary ? `${params.itemsSummary}-এর ` : "";
  const total = params.totalFormatted ? `মোট ${params.totalFormatted} টাকার ` : "";

  return `${intro}${customerPart}${brand} থেকে আপনার ${items}${total}ক্যাশ অন ডেলিভারি অর্ডারটি নিশ্চিত করতে ১ চাপুন, অথবা অর্ডারটি বাতিল করতে ২ চাপুন।`;
}
