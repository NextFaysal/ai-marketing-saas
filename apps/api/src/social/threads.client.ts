import { Injectable, Optional } from "@nestjs/common";

/**
 * SN7 — Threads API client + container publisher
 * (docs/social-sn7-threads-spike.md). Threads is a Meta app
 * family of its own: authorize on threads.net, tokens and Graph
 * calls on graph.threads.net, with a Threads App ID/Secret that
 * are DISTINCT from the Facebook app's.
 *
 * Publishing is a two-step CONTAINER flow: create a container
 * (TEXT / IMAGE / VIDEO / CAROUSEL), wait for its documented
 * status to reach FINISHED (bounded polling — an unbounded wait
 * would hang the worker), then threads_publish. Media rides
 * public URLs that Meta fetches itself — there is no byte
 * upload, exactly like the Meta/Instagram path.
 *
 * Error discipline: Meta's error.message propagates VERBATIM
 * (with the HTTP status attached for the token-death rules).
 * No token is ever logged or embedded in an error.
 */

const GRAPH_BASE = "https://graph.threads.net/v1.0";
const TOKEN_BASE = "https://graph.threads.net";

export type ThreadsFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export interface ThreadsAppCreds {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface ThreadsTokenSet {
  accessToken: string;
  /** ms epoch the long-lived token expires at (Threads tokens
   * are 60-day; the exchange response's expires_in drives it). */
  expiresAt: number;
  /** The Threads user id from the code exchange (null when the
   * response carried none — the profile call is the fallback). */
  userId: string | null;
  /** Always absent for Threads (the access token itself is the
   * refresh grant) — declared so the OAuth service's shared
   * refresh-persist code can treat every platform's token set
   * uniformly, exactly like the other clients' sets. */
  refreshToken?: string;
  scope?: string;
}

export interface ThreadsProfile {
  id: string;
  username: string | null;
  name: string | null;
  pictureUrl: string | null;
}

export interface ThreadsContainerStatus {
  status: string;
  errorMessage: string | null;
}

/** The documented insights metric set for a Threads media. */
export const THREADS_MEDIA_INSIGHT_METRICS = ["views", "likes", "replies", "reposts", "quotes", "shares"] as const;

@Injectable()
export class ThreadsClient {
  private readonly fetchFn: ThreadsFetch;

  // @Optional(): see TelegramClient — the fetch injection
  // is a test seam, not a Nest provider (pre-existing base
  // bug found by FB1's boot smoke; same one-line fix).
  constructor(@Optional() fetchFn?: ThreadsFetch) {
    this.fetchFn = fetchFn ?? ((url, init) => fetch(url, init as any) as any);
  }

  /** Threads Graph error shape: { error: { message, type,
   * code } }. The message propagates verbatim; the HTTP status
   * rides along for the shared token-death rule. */
  private async parse(res: { ok: boolean; status: number; json: () => Promise<any> }): Promise<any> {
    const json = await res.json().catch(() => null);
    const graphError = json?.error;
    if (graphError) {
      const message = typeof graphError.message === "string" && graphError.message
        ? graphError.message
        : `Threads API error (HTTP ${res.status})`;
      const err = new Error(message) as Error & { status?: number; code?: number };
      err.status = res.status;
      if (typeof graphError.code === "number") err.code = graphError.code;
      throw err;
    }
    if (!res.ok || json == null) {
      const err = new Error(`Threads API error (HTTP ${res.status})`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return json;
  }

  private async get(path: string, params: Record<string, string>): Promise<any> {
    const qs = new URLSearchParams(params).toString();
    return this.parse(await this.fetchFn(`${GRAPH_BASE}${path}?${qs}`, { method: "GET" }));
  }

  private async postForm(url: string, fields: Record<string, string>): Promise<any> {
    return this.parse(await this.fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    }));
  }

  private async graphPost(path: string, accessToken: string, fields: Record<string, string>): Promise<any> {
    return this.postForm(`${GRAPH_BASE}${path}`, { ...fields, access_token: accessToken });
  }

  // ---------- OAuth token lifecycle ----------

  /** Step 1 of the callback: authorization code → SHORT-lived
   * token (1h) + the Threads user id. */
  async exchangeCode(creds: ThreadsAppCreds, code: string): Promise<{ shortLivedToken: string; userId: string | null }> {
    const json = await this.postForm(`${TOKEN_BASE}/oauth/access_token`, {
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: "authorization_code",
      redirect_uri: creds.redirectUri,
      code,
    });
    const token = typeof json?.access_token === "string" ? json.access_token : "";
    if (!token) throw new Error("Threads Token বিনিময়ে কোনো access token পাওয়া যায়নি।");
    return {
      shortLivedToken: token,
      userId: json?.user_id != null ? String(json.user_id) : null,
    };
  }

  /** Step 2: short-lived → LONG-lived (60-day) token. Needs the
   * app secret (th_exchange_token). */
  async exchangeLongLived(creds: ThreadsAppCreds, shortLivedToken: string): Promise<ThreadsTokenSet> {
    const qs = new URLSearchParams({
      grant_type: "th_exchange_token",
      client_secret: creds.clientSecret,
      access_token: shortLivedToken,
    }).toString();
    const json = await this.parse(await this.fetchFn(`${TOKEN_BASE}/access_token?${qs}`, { method: "GET" }));
    const token = typeof json?.access_token === "string" ? json.access_token : "";
    if (!token) throw new Error("Threads long-lived Token বিনিময়ে কোনো access token পাওয়া যায়নি।");
    const expiresInSec = typeof json?.expires_in === "number" && json.expires_in > 0 ? json.expires_in : 60 * 86_400;
    return { accessToken: token, expiresAt: Date.now() + expiresInSec * 1000, userId: null };
  }

  /** Refresh a long-lived token (th_refresh_token). Documented
   * to need NO app secret — just the current (≥24h old, still
   * valid) long-lived token. */
  async refreshLongLived(accessToken: string): Promise<ThreadsTokenSet> {
    const qs = new URLSearchParams({
      grant_type: "th_refresh_token",
      access_token: accessToken,
    }).toString();
    const json = await this.parse(await this.fetchFn(`${TOKEN_BASE}/refresh_access_token?${qs}`, { method: "GET" }));
    const token = typeof json?.access_token === "string" ? json.access_token : "";
    if (!token) throw new Error("Threads Token refresh-এ কোনো access token পাওয়া যায়নি।");
    const expiresInSec = typeof json?.expires_in === "number" && json.expires_in > 0 ? json.expires_in : 60 * 86_400;
    return { accessToken: token, expiresAt: Date.now() + expiresInSec * 1000, userId: null };
  }

  // ---------- identity ----------

  async getProfile(accessToken: string): Promise<ThreadsProfile> {
    const json = await this.get("/me", {
      fields: "id,username,name,threads_profile_picture_url",
      access_token: accessToken,
    });
    return {
      id: json?.id != null ? String(json.id) : "",
      username: typeof json?.username === "string" ? json.username : null,
      name: typeof json?.name === "string" ? json.name : null,
      pictureUrl: typeof json?.threads_profile_picture_url === "string" ? json.threads_profile_picture_url : null,
    };
  }

  // ---------- container publishing ----------

  /** Create ONE container. `input.mediaType` is TEXT / IMAGE /
   * VIDEO / CAROUSEL; children carry is_carousel_item and no
   * text; the CAROUSEL parent carries children (comma-joined
   * container ids) + the text. */
  async createContainer(
    accessToken: string, threadsUserId: string,
    input: {
      mediaType: "TEXT" | "IMAGE" | "VIDEO" | "CAROUSEL";
      text?: string;
      imageUrl?: string;
      videoUrl?: string;
      isCarouselItem?: boolean;
      children?: string[];
    },
  ): Promise<{ containerId: string }> {
    const fields: Record<string, string> = { media_type: input.mediaType };
    if (input.text) fields.text = input.text;
    if (input.imageUrl) fields.image_url = input.imageUrl;
    if (input.videoUrl) fields.video_url = input.videoUrl;
    if (input.isCarouselItem) fields.is_carousel_item = "true";
    if (input.children?.length) fields.children = input.children.join(",");
    const json = await this.graphPost(`/${threadsUserId}/threads`, accessToken, fields);
    const id = json?.id != null ? String(json.id) : "";
    if (!id) throw new Error("Threads Container তৈরি হয়েছে কিন্তু কোনো ID পাওয়া যায়নি।");
    return { containerId: id };
  }

  async getContainerStatus(accessToken: string, containerId: string): Promise<ThreadsContainerStatus> {
    const json = await this.get(`/${containerId}`, {
      fields: "status,error_message",
      access_token: accessToken,
    });
    return {
      status: String(json?.status ?? ""),
      errorMessage: typeof json?.error_message === "string" ? json.error_message : null,
    };
  }

  async publishContainer(accessToken: string, threadsUserId: string, containerId: string): Promise<{ mediaId: string }> {
    const json = await this.graphPost(`/${threadsUserId}/threads_publish`, accessToken, {
      creation_id: containerId,
    });
    const id = json?.id != null ? String(json.id) : "";
    if (!id) throw new Error("Threads Publish হয়েছে কিন্তু কোনো Media ID পাওয়া যায়নি।");
    return { mediaId: id };
  }

  /** The published post's public permalink — a SEPARATE call;
   * callers treat failure as "no URL" (the post IS published). */
  async getPermalink(accessToken: string, mediaId: string): Promise<string | null> {
    const json = await this.get(`/${mediaId}`, {
      fields: "permalink",
      access_token: accessToken,
    });
    return typeof json?.permalink === "string" && json.permalink ? json.permalink : null;
  }

  // ---------- insights (threads_manage_insights) ----------

  /** Documented media metrics only; a metric Threads omits
   * stays ABSENT from the result (never a fabricated 0). */
  async getMediaInsights(accessToken: string, mediaId: string): Promise<Record<string, number>> {
    const json = await this.get(`/${mediaId}/insights`, {
      metric: THREADS_MEDIA_INSIGHT_METRICS.join(","),
      access_token: accessToken,
    });
    const out: Record<string, number> = {};
    for (const entry of Array.isArray(json?.data) ? json.data : []) {
      const name = typeof entry?.name === "string" ? entry.name : "";
      const value = entry?.values?.[0]?.value;
      if (name && typeof value === "number" && Number.isFinite(value)) out[name] = value;
    }
    return out;
  }

  /** followers_count from USER insights (the profile itself
   * carries no follower field). Null when Threads returns no
   * value — the snapshot then SKIPS the account (SU7 rule). */
  async getFollowerCount(accessToken: string, threadsUserId: string): Promise<number | null> {
    const json = await this.get(`/${threadsUserId}/threads_insights`, {
      metric: "followers_count",
      access_token: accessToken,
    });
    const entry = (Array.isArray(json?.data) ? json.data : []).find((d: any) => d?.name === "followers_count") ?? json?.data?.[0];
    const value = entry?.total_value?.value ?? entry?.values?.[0]?.value;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
}

/** Container-processing poll bounds (TikTokPublisher precedent):
 * at most 20 status checks, 3s apart — a container that never
 * finishes fails honestly instead of hanging the worker. */
const MAX_CONTAINER_POLLS = 20;
const CONTAINER_POLL_DELAY_MS = 3_000;

export interface ThreadsPublishInput {
  accessToken: string;
  threadsUserId: string;
  text: string;
  /** Resolved public media URLs, in post order. */
  media: { kind: "image" | "video"; url: string }[];
}

@Injectable()
export class ThreadsPublisher {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxPolls: number;
  private readonly pollDelayMs: number;

  constructor(
    private readonly client: ThreadsClient,
    opts?: { sleep?: (ms: number) => Promise<void>; maxPolls?: number; pollDelayMs?: number },
  ) {
    this.sleep = opts?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxPolls = opts?.maxPolls ?? MAX_CONTAINER_POLLS;
    this.pollDelayMs = opts?.pollDelayMs ?? CONTAINER_POLL_DELAY_MS;
  }

  /** Poll one container to a terminal state. FINISHED (or an
   * already-PUBLISHED read) proceeds; ERROR/EXPIRED fails with
   * the container's own error_message verbatim; exhausting the
   * bounded polls fails with an honest timeout message. */
  private async waitContainerReady(accessToken: string, containerId: string): Promise<void> {
    for (let attempt = 0; attempt < this.maxPolls; attempt++) {
      const { status, errorMessage } = await this.client.getContainerStatus(accessToken, containerId);
      if (status === "FINISHED" || status === "PUBLISHED") return;
      if (status === "ERROR" || status === "EXPIRED") {
        throw new Error(errorMessage || `Threads Container ${status} অবস্থায় শেষ হয়েছে — পোস্টটি প্রকাশ করা যায়নি।`);
      }
      if (attempt < this.maxPolls - 1) await this.sleep(this.pollDelayMs);
    }
    throw new Error("Threads Container নির্দিষ্ট সময়ে প্রস্তুত হয়নি (Processing timeout) — কিছুক্ষণ পর আবার চেষ্টা করুন।");
  }

  /**
   * The documented container flow:
   * - 0 media → one TEXT container;
   * - 1 media → one IMAGE/VIDEO container with the text;
   * - 2–20 media → one child container per item (each polled to
   *   FINISHED), then a CAROUSEL parent carrying the text.
   * The parent is polled to FINISHED, then published. Returns
   * the published media id; the permalink is the caller's
   * best-effort follow-up (a permalink failure must not
   * unpublish a published post).
   */
  async publish(input: ThreadsPublishInput): Promise<{ mediaId: string }> {
    const { accessToken, threadsUserId, text, media } = input;
    let containerId: string;
    if (media.length === 0) {
      ({ containerId } = await this.client.createContainer(accessToken, threadsUserId, {
        mediaType: "TEXT", text,
      }));
    } else if (media.length === 1) {
      const only = media[0]!;
      ({ containerId } = await this.client.createContainer(accessToken, threadsUserId, {
        mediaType: only.kind === "video" ? "VIDEO" : "IMAGE",
        ...(only.kind === "video" ? { videoUrl: only.url } : { imageUrl: only.url }),
        text: text || undefined,
      }));
    } else {
      const childIds: string[] = [];
      for (const item of media) {
        const child = await this.client.createContainer(accessToken, threadsUserId, {
          mediaType: item.kind === "video" ? "VIDEO" : "IMAGE",
          ...(item.kind === "video" ? { videoUrl: item.url } : { imageUrl: item.url }),
          isCarouselItem: true,
        });
        await this.waitContainerReady(accessToken, child.containerId);
        childIds.push(child.containerId);
      }
      ({ containerId } = await this.client.createContainer(accessToken, threadsUserId, {
        mediaType: "CAROUSEL", children: childIds, text: text || undefined,
      }));
    }
    await this.waitContainerReady(accessToken, containerId);
    return this.client.publishContainer(accessToken, threadsUserId, containerId);
  }
}
