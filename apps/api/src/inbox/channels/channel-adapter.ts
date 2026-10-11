/**
 * Unified Inbox U4: the formal channel-adapter contract every
 * messaging channel implements — verify credentials BEFORE
 * anything is saved, parse nothing here (ingest lives in the
 * channel services), and send only against the channel's real
 * API, returning the platform's own message id.
 *
 * Meta (WhatsApp/Messenger/Instagram) predates this contract and
 * keeps its proven client/webhook path; the webchat lane is
 * served in-process. New channels (Telegram, Email) implement
 * this interface, and TikTok ships as a clearly labeled
 * partner-gated adapter whose operations refuse honestly until
 * TikTok approves the business's partner application.
 */
export interface VerifiedChannelAccount {
  externalAccountId: string;
  displayName: string;
}

export interface ChannelAdapter {
  readonly channel: string;
  verifyCredentials(credentials: Record<string, any>): Promise<VerifiedChannelAccount>;
  sendText(credentials: Record<string, any>, externalContactId: string, text: string): Promise<{ externalId: string }>;
}

/** Development adapter for partner-gated TikTok Business
 * Messaging. It NEVER pretends to verify or send: every operation
 * refuses with the real reason, so nothing downstream can mistake
 * it for a live channel. Replace with the partner API client once
 * TikTok approves the application (see docs/unified-inbox-plan.md). */
export class TikTokPartnerGatedAdapter implements ChannelAdapter {
  readonly channel = "tiktok";
  private refuse(): never {
    throw new Error(
      "TikTok Business Messaging is partner-gated: it requires a TikTok Business Account and an approved " +
      "messaging partner application. Until TikTok approves, TikTok ad clicks can be routed to WhatsApp/Messenger, " +
      "which already work in this inbox. No message was sent.",
    );
  }
  async verifyCredentials(_credentials: Record<string, any>): Promise<VerifiedChannelAccount> { return this.refuse(); }
  async sendText(_credentials: Record<string, any>, _externalContactId: string, _text: string): Promise<{ externalId: string }> { return this.refuse(); }
}

export const TIKTOK_APPLICATION_PACK = {
  available: false,
  reason: "TikTok Business Messaging API access is granted through approved partners, not self-serve app review.",
  steps: [
    "Create/verify a TikTok Business Center account for the business (accounts registered in EEA/Switzerland/UK and some regions are excluded by TikTok).",
    "Apply to TikTok's Business Messaging partner program (or onboard through an already-approved messaging partner).",
    "Complete TikTok's business verification for the messaging use case (customer support + notifications).",
    "Once approved, connect the account here — the adapter activates with the partner-issued credentials; until then this lane stays visibly unavailable instead of pretending to work.",
    "Meanwhile: TikTok Ads 'instant messaging' campaigns can route clicks to WhatsApp or Messenger, which this inbox already receives, assigns and auto-replies to.",
  ],
};
