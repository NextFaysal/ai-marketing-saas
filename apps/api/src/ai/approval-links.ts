import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * AP7 signed approval links — the security-reviewed design for
 * approving an AI proposal from outside the dashboard (e.g. a link
 * pasted into Telegram):
 *
 * - The token is an HMAC-SHA256 over `${proposalId}.${expiresAt}`
 *   with a server-only secret (env ASSISTANT_LINK_SECRET, falling
 *   back to INTERNAL_JOB_SECRET). No secret configured → the
 *   feature is DISABLED, honestly — links are never minted.
 * - A link is inherently ONE-TIME: approval consumes the proposal
 *   (the atomic claim in ProposalsService.approve), so replaying
 *   the link after a decision only shows "already decided".
 * - Links expire after 48 hours.
 * - The decision executes as the org's OWNER (first active OWNER
 *   membership) through the ordinary approve()/reject() path —
 *   audit records that actor; nothing executes on the GET (the
 *   GET only renders a confirm page; the POST decides), so chat
 *   link-preview bots cannot approve by fetching the URL.
 */

export const APPROVAL_LINK_TTL_MS = 48 * 3600_000;

export function approvalLinkSecret(): string | null {
  return process.env.ASSISTANT_LINK_SECRET || process.env.INTERNAL_JOB_SECRET || null;
}

function sign(secret: string, proposalId: string, exp: number): string {
  return createHmac("sha256", secret).update(`${proposalId}.${exp}`).digest("base64url");
}

export function mintApprovalToken(secret: string, proposalId: string, now = Date.now()): { token: string; expiresAt: number } {
  const expiresAt = now + APPROVAL_LINK_TTL_MS;
  return { token: `${expiresAt}.${sign(secret, proposalId, expiresAt)}`, expiresAt };
}

export function verifyApprovalToken(secret: string, proposalId: string, token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const exp = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(exp) || exp < now) return false;
  const expected = sign(secret, proposalId, exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
