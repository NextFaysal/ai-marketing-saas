import { Injectable, Optional } from "@nestjs/common";
import { graphGet } from "../common/meta-graph";
import { SocialPublishService } from "../social/social-publish.service";

/**
 * NF1 (FB1) — LiveCommentsProvider PORT (see
 * docs/nf1-meta-live-spike.md §৩). v1 has ONE implementation,
 * MetaLiveCommentsProvider below; the port exists so a future
 * platform (or the SSE live_comments stream, deliberately NOT
 * used in v1) can be added without touching the service.
 *
 * The result is a discriminated union: either real comments in
 * the ONE evidenced Graph shape, or a typed `unavailable` with
 * a human reason. There is no third outcome — the provider
 * NEVER fabricates comments.
 */
export interface MetaLiveComment {
  externalCommentId: string;
  commenterExternalId: string | null;
  commenterName: string;
  message: string;
  commentedAt: Date;
}

export type LiveCommentsResult =
  | { status: "ok"; comments: MetaLiveComment[] }
  | { status: "unavailable"; reason: string };

export interface LiveCommentsProvider {
  fetchComments(input: {
    organizationId: string;
    socialAccountId: string | null;
    externalLiveVideoId: string | null;
  }): Promise<LiveCommentsResult>;
}

/** DI token for the port (the codebase's structural-port style:
 * a symbol token + the real implementation bound in the module). */
export const LIVE_COMMENTS_PROVIDER = Symbol("LIVE_COMMENTS_PROVIDER");

const UNAVAILABLE_NO_ACCOUNT = "কোনো Meta অ্যাকাউন্ট যুক্ত নেই — সেশনটি manual মোডে চলছে";
const UNAVAILABLE_NO_VIDEO = "Live video ID নেই — সেশনটি manual মোডে চলছে";

/**
 * Meta implementation — uses ONLY the evidenced shape from the
 * spike: `GET /{live-video-id}/comments` returning
 * `{ data: [{ id, created_time, from: { id, name }, message }],
 *    paging: { cursors } }`, via the shared graphGet helper
 * (common/meta-graph.ts — the codebase's ONE Graph client).
 *
 * The Page token comes from the EXISTING credential machinery:
 * SocialPublishService.resolveAccountToken (SocialAccount →
 * Integration → sealed credential decrypt). NF1 invents no
 * token storage. ANY failure on that path (no account, account
 * disconnected, missing credential, decrypt failure) or from
 * Graph itself resolves to the typed unavailable — the caller
 * then serves stored comments in labelled manual mode.
 */
@Injectable()
export class MetaLiveCommentsProvider implements LiveCommentsProvider {
  constructor(
    @Optional() private readonly socialPublish?: SocialPublishService,
    // Test seam: specs inject a fake Graph GET; production uses
    // the real graphGet from common/meta-graph.
    @Optional() private readonly graphGetFn?: typeof graphGet,
  ) {}

  async fetchComments(input: {
    organizationId: string;
    socialAccountId: string | null;
    externalLiveVideoId: string | null;
  }): Promise<LiveCommentsResult> {
    if (!input.socialAccountId) return { status: "unavailable", reason: UNAVAILABLE_NO_ACCOUNT };
    if (!input.externalLiveVideoId) return { status: "unavailable", reason: UNAVAILABLE_NO_VIDEO };
    if (!this.socialPublish?.resolveAccountToken) {
      return { status: "unavailable", reason: UNAVAILABLE_NO_ACCOUNT };
    }
    let accessToken: string;
    try {
      ({ accessToken } = await this.socialPublish.resolveAccountToken(input.organizationId, input.socialAccountId));
    } catch (e: any) {
      // PermanentPublishError messages from resolveAccountToken
      // are already merchant-safe Bengali; anything else gets
      // the generic manual-mode reason (never internals).
      const reason = e?.name === "PermanentPublishError" && typeof e?.message === "string" && e.message
        ? e.message
        : UNAVAILABLE_NO_ACCOUNT;
      return { status: "unavailable", reason };
    }
    let body: any;
    try {
      const get = this.graphGetFn ?? graphGet;
      body = await get(accessToken, `/${encodeURIComponent(input.externalLiveVideoId)}/comments`, {
        fields: "id,created_time,from{id,name},message",
        order: "chronological",
        filter: "stream",
      });
    } catch (e: any) {
      const msg = typeof e?.message === "string" && e.message ? e.message : "Meta থেকে comments আনা যায়নি";
      return { status: "unavailable", reason: `Meta comments পাওয়া যায়নি: ${msg}` };
    }
    const rows = Array.isArray(body?.data) ? body.data : [];
    const comments: MetaLiveComment[] = [];
    for (const row of rows) {
      // Defensive mapping of the evidenced shape only — a row
      // without an id or message is not a comment we can store
      // honestly, so it is skipped rather than guessed at.
      if (!row?.id || typeof row?.message !== "string") continue;
      const created = row.created_time ? new Date(row.created_time) : new Date();
      comments.push({
        externalCommentId: String(row.id),
        commenterExternalId: row.from?.id != null ? String(row.from.id) : null,
        commenterName: typeof row.from?.name === "string" && row.from.name ? row.from.name : "Facebook ব্যবহারকারী",
        message: row.message,
        commentedAt: Number.isNaN(created.getTime()) ? new Date() : created,
      });
    }
    return { status: "ok", comments };
  }
}
