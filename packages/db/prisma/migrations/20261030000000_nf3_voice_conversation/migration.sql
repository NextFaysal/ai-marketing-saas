-- NF3 (FB2): AI Voice Agent conversation upgrade.
-- Hand-written to match schema.prisma exactly (the repo's
-- hand-written migration style). VoiceCallSetting gains the
-- conversation-agent fields (off by default, simulation mode by
-- default); OrderVoiceCall gains conversation outcome / summary /
-- follow-up fields; new VoiceConversationTurn persists every
-- turn of a conversation, org-scoped and per call.

ALTER TABLE "VoiceCallSetting" ADD COLUMN "conversationAgentEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "VoiceCallSetting" ADD COLUMN "conversationMode" TEXT NOT NULL DEFAULT 'simulation';
ALTER TABLE "VoiceCallSetting" ADD COLUMN "relayWebsocketUrl" TEXT;
ALTER TABLE "VoiceCallSetting" ADD COLUMN "conversationLanguage" TEXT NOT NULL DEFAULT 'bn-BD';
ALTER TABLE "VoiceCallSetting" ADD COLUMN "sttProvider" TEXT NOT NULL DEFAULT 'google';
ALTER TABLE "VoiceCallSetting" ADD COLUMN "ttsProvider" TEXT NOT NULL DEFAULT 'amazon';
ALTER TABLE "VoiceCallSetting" ADD COLUMN "ttsVoice" TEXT NOT NULL DEFAULT 'Polly.Nabanita';

ALTER TABLE "OrderVoiceCall" ADD COLUMN "conversationOutcome" TEXT;
ALTER TABLE "OrderVoiceCall" ADD COLUMN "conversationSummary" TEXT;
ALTER TABLE "OrderVoiceCall" ADD COLUMN "followUpStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "OrderVoiceCall" ADD COLUMN "followUpChannel" TEXT;
ALTER TABLE "OrderVoiceCall" ADD COLUMN "actionAppliedAt" TIMESTAMP(3);

CREATE TABLE "VoiceConversationTurn" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "intent" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceConversationTurn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoiceConversationTurn_callId_seq_key" ON "VoiceConversationTurn"("callId", "seq");
CREATE INDEX "VoiceConversationTurn_organizationId_callId_seq_idx" ON "VoiceConversationTurn"("organizationId", "callId", "seq");

ALTER TABLE "VoiceConversationTurn" ADD CONSTRAINT "VoiceConversationTurn_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoiceConversationTurn" ADD CONSTRAINT "VoiceConversationTurn_callId_fkey" FOREIGN KEY ("callId") REFERENCES "OrderVoiceCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;
