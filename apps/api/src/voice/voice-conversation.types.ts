/**
 * NF3 (FB2): AI Voice Agent conversation — port + the evidenced
 * Twilio ConversationRelay WebSocket message shapes.
 *
 * The message interfaces carry ONLY the fields evidenced in
 * docs/nf3-voice-conversation-spike.md (Twilio ConversationRelay
 * websocket-messages doc, fetched 2026-10-17). No other fields
 * are assumed.
 */

export type ConversationMode = "simulation" | "twilio_relay";

export interface VoiceConversationFacts {
  customerName: string | null;
  brandName: string;
  itemsSummary: string;
  totalFormatted: string;
  address: string | null;
  deliveryFactLines: string[];
}

/**
 * Port every conversation transport implements. `simulation`
 * is the labelled dev/simulation path (typed text stands in for
 * the transcript — no telephony, no STT/TTS); `twilio_relay` is
 * config-gated on the org's own relay WebSocket URL.
 */
export interface VoiceConversationStartInput {
  organizationId: string;
  orderId: string;
  callId: string;
  greeting: string;
}

export interface VoiceConversationProvider {
  mode: ConversationMode;
  startConversation(
    input: VoiceConversationStartInput,
  ): Promise<{ mode: ConversationMode; agentLine: string }>;
}

export class SimulationConversationProvider implements VoiceConversationProvider {
  readonly mode = "simulation" as const;
  async startConversation(input: VoiceConversationStartInput) {
    return { mode: this.mode, agentLine: input.greeting };
  }
}

export class TwilioRelayConversationProvider implements VoiceConversationProvider {
  readonly mode = "twilio_relay" as const;
  async startConversation(input: VoiceConversationStartInput) {
    return { mode: this.mode, agentLine: input.greeting };
  }
}

// --- Twilio ConversationRelay WebSocket messages (evidenced) ---

export interface RelaySetupMessage {
  type: "setup";
  sessionId?: string;
  callSid?: string;
  from?: string;
  to?: string;
  callStatus?: string;
  customParameters?: Record<string, string>;
}

export interface RelayPromptMessage {
  type: "prompt";
  voicePrompt: string;
  lang?: string;
  last: boolean;
}

export interface RelayDtmfMessage {
  type: "dtmf";
  digit: string;
}

export interface RelayInterruptMessage {
  type: "interrupt";
  utteranceUntilInterrupt?: string;
  durationUntilInterruptMs?: number;
}

export interface RelayErrorMessage {
  type: "error";
  description?: string;
}

export type RelayInboundMessage =
  | RelaySetupMessage
  | RelayPromptMessage
  | RelayDtmfMessage
  | RelayInterruptMessage
  | RelayErrorMessage;

/** Outbound reply shape: the app sends text, the relay speaks it. */
export interface RelayTextMessage {
  type: "text";
  token: string;
  last: boolean;
}
