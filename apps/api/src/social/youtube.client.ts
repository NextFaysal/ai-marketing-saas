/**
 * SP9 — YouTube Data API client (operator-app Google OAuth).
 *
 * Same operator-app model as SP8: the SaaS operator registers
 * ONE Google app; tenants OAuth their own Google accounts into
 * it and pick one of their channels. This class only talks
 * HTTP — persistence/state live in SocialOAuthService, publish
 * semantics in SocialPublishService.
 *
 * HONEST v1 SHAPE (plan amendment): uploads from an app that
 * has not passed Google's verification are LOCKED TO PRIVATE by
 * YouTube itself. We therefore REQUEST privacyStatus "private"
 * openly (see initiateResumable) instead of requesting public
 * and misreporting the result — the video is genuinely on the
 * channel (visible in YouTube Studio), and the UI states the
 * private lock verbatim via the post's publishNote.
 *
 * Upload protocol: the documented resumable protocol, followed
 * faithfully — initiate a session, PUT the bytes, and on any
 * mid-upload failure QUERY THE SESSION STATUS before resuming
 * (never restart blindly): a 308 + Range header says exactly how
 * many bytes YouTube holds, and the resume continues from there.
 *
 * PP2: the bytes now come from a YouTubeByteSource (bounded range
 * reads — MediaStore in production) and move in fixed-size
 * chunks, so a 256 MB video never sits in memory whole. Chunk
 * size is a multiple of YouTube's 256 KiB granularity rule.
 *
 * Error discipline: Google's own error message propagates
 * VERBATIM (error bodies are { error: { message } } on Data API
 * endpoints and { error, error_description } on the token
 * endpoint).
 */

export interface GoogleTokenSet {
  accessToken: string;
  /** Google returns a refresh token only on the first consent
   * (we force prompt=consent so reconnects re-issue one too). */
  refreshToken?: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  scope?: string;
}

export interface GoogleAppCreds {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface YouTubeChannel {
  id: string;
  title: string;
  pictureUrl: string | null;
}

/** SN1: one playlist of the authorized user's own channel. */
export interface YouTubePlaylist {
  id: string;
  title: string;
}

/** SN8: one recent upload from the authorized user's own
 * uploads playlist (syndication reads these to auto-draft). */
export interface YouTubeUpload {
  videoId: string;
  title: string;
  publishedAt: string | null;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

/** Read a header from either a real Headers object or a plain
 * stub object (specs) — case-insensitively. */
function header(res: any, name: string): string | null {
  const h = res?.headers;
  if (!h) return null;
  if (typeof h.get === "function") return h.get(name) ?? h.get(name.toLowerCase());
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? String(h[key]) : null;
}

export class YouTubeClient {
  private readonly fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch = fetch) {
    this.fetchFn = fetchFn;
  }

  /** Throw Google's verbatim error for a failed response. */
  private async fail(res: Response, context: string): Promise<never> {
    const body: any = await res.json().catch(() => null);
    const message = body?.error?.message ?? body?.error_description ?? body?.error ?? `${context} failed (HTTP ${res.status})`;
    const err = new Error(String(message)) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  private tokenSet(body: any): GoogleTokenSet {
    return {
      accessToken: String(body.access_token ?? ""),
      refreshToken: body.refresh_token ? String(body.refresh_token) : undefined,
      expiresAt: Date.now() + Number(body.expires_in ?? 0) * 1000,
      scope: body.scope ? String(body.scope) : undefined,
    };
  }

  async exchangeCode(creds: GoogleAppCreds, code: string): Promise<GoogleTokenSet> {
    const res = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: creds.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
    if (!res.ok) await this.fail(res, "Google token exchange");
    const body: any = await res.json().catch(() => null);
    if (!body?.access_token) throw new Error("Google token exchange returned no access token");
    return this.tokenSet(body);
  }

  /** Refresh grant — Google does NOT rotate the refresh token
   * and does not return a new one; the caller keeps the old. */
  async refreshAccessToken(creds: GoogleAppCreds, refreshToken: string): Promise<GoogleTokenSet> {
    const res = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (!res.ok) await this.fail(res, "Google token refresh");
    const body: any = await res.json().catch(() => null);
    if (!body?.access_token) throw new Error("Google token refresh returned no access token");
    return this.tokenSet(body);
  }

  /** The authorized user's own channels (mine=true). */
  async listChannels(accessToken: string): Promise<YouTubeChannel[]> {
    const res = await this.fetchFn(CHANNELS_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) await this.fail(res, "YouTube channels list");
    const body: any = await res.json().catch(() => null);
    const items: any[] = Array.isArray(body?.items) ? body.items : [];
    return items.map((it) => ({
      id: String(it.id),
      title: String(it.snippet?.title ?? it.id),
      pictureUrl: it.snippet?.thumbnails?.default?.url ? String(it.snippet.thumbnails.default.url) : null,
    }));
  }

  /**
   * Step 1 of the resumable upload: create the session. The
   * metadata (title/description) travels HERE, per protocol.
   *
   * privacyStatus is "private" ON PURPOSE: YouTube locks every
   * upload from an unverified app to private regardless of what
   * is requested, so requesting private is the honest contract —
   * the post's publishNote tells the tenant exactly this.
   */
  async initiateResumable(accessToken: string, args: {
    title: string; description: string; contentType: string; contentLength: number;
    // SU8: optional YouTube metadata — added to the snippet ONLY
    // when present, so a call without them sends the exact
    // pre-SU8 body (SP9 spec pins that shape).
    tags?: string[]; categoryId?: string;
  }): Promise<string> {
    const snippet: Record<string, unknown> = { title: args.title, description: args.description };
    if (args.tags !== undefined) snippet.tags = args.tags;
    if (args.categoryId !== undefined) snippet.categoryId = args.categoryId;
    const res = await this.fetchFn(UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": args.contentType,
        "X-Upload-Content-Length": String(args.contentLength),
      },
      body: JSON.stringify({
        snippet,
        status: { privacyStatus: "private" },
      }),
    });
    if (!res.ok) await this.fail(res, "YouTube upload initiation");
    const location = header(res, "location");
    if (!location) throw new Error("YouTube upload initiation returned no session URI (Location header)");
    return location;
  }

  /**
   * SN1 — the authorized user's own playlists (playlists.list,
   * mine=true), following nextPageToken to the end. Only id +
   * title are kept: that is all the composer picker shows.
   */
  async listPlaylists(accessToken: string): Promise<YouTubePlaylist[]> {
    const out: YouTubePlaylist[] = [];
    let pageToken: string | null = null;
    do {
      const qs = new URLSearchParams({ part: "snippet", mine: "true", maxResults: "50" });
      if (pageToken) qs.set("pageToken", pageToken);
      const res = await this.fetchFn(`https://www.googleapis.com/youtube/v3/playlists?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) await this.fail(res, "YouTube playlists list");
      const body: any = await res.json().catch(() => null);
      const items: any[] = Array.isArray(body?.items) ? body.items : [];
      for (const it of items) {
        out.push({ id: String(it.id), title: String(it.snippet?.title ?? it.id) });
      }
      pageToken = body?.nextPageToken ? String(body.nextPageToken) : null;
    } while (pageToken);
    return out;
  }

  /**
   * SN8 — the authorized user's recent uploads: channels.list
   * (part=contentDetails, mine=true) gives the channel's
   * relatedPlaylists.uploads playlist, and one page of
   * playlistItems.list on it is the recent-uploads list (no
   * pageToken following — one page is enough for a sweep).
   * No uploads playlist → an empty list, not an error.
   * Google's errors propagate verbatim (fail()).
   */
  async listRecentUploads(accessToken: string, maxResults = 10): Promise<YouTubeUpload[]> {
    const channelsRes = await this.fetchFn(
      "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!channelsRes.ok) await this.fail(channelsRes, "YouTube channels list");
    const channelsBody: any = await channelsRes.json().catch(() => null);
    const channelItems: any[] = Array.isArray(channelsBody?.items) ? channelsBody.items : [];
    const uploads = channelItems[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads || typeof uploads !== "string") return [];
    const qs = new URLSearchParams({
      part: "snippet,contentDetails",
      playlistId: uploads,
      maxResults: String(maxResults),
    });
    const res = await this.fetchFn(`https://www.googleapis.com/youtube/v3/playlistItems?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) await this.fail(res, "YouTube playlist items list");
    const body: any = await res.json().catch(() => null);
    const items: any[] = Array.isArray(body?.items) ? body.items : [];
    const out: YouTubeUpload[] = [];
    for (const it of items) {
      const videoId = it?.contentDetails?.videoId ?? it?.snippet?.resourceId?.videoId;
      if (!videoId) continue;
      const published = it?.contentDetails?.videoPublishedAt ?? it?.snippet?.publishedAt ?? null;
      out.push({
        videoId: String(videoId),
        title: String(it?.snippet?.title ?? videoId),
        publishedAt: published ? String(published) : null,
      });
    }
    return out;
  }

  /**
   * SN1 — add a video to a playlist (playlistItems.insert). The
   * resource shape is YouTube's documented one: snippet.playlistId
   * + snippet.resourceId { kind: "youtube#video", videoId }.
   * Google's errors propagate verbatim (fail()).
   */
  async addToPlaylist(accessToken: string, playlistId: string, videoId: string): Promise<void> {
    const res = await this.fetchFn("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        snippet: {
          playlistId,
          resourceId: { kind: "youtube#video", videoId },
        },
      }),
    });
    if (!res.ok) await this.fail(res, "YouTube playlist add");
  }

  /**
   * SN1 — post a top-level comment on a video (commentThreads.
   * insert): the documented shape carries the text under
   * snippet.topLevelComment.snippet.textOriginal, bound to the
   * video via snippet.videoId. Returns the new comment's id.
   * Google's errors propagate verbatim (fail()).
   */
  async postComment(accessToken: string, videoId: string, text: string): Promise<{ commentId: string }> {
    const res = await this.fetchFn("https://www.googleapis.com/youtube/v3/commentThreads?part=snippet", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        snippet: {
          videoId,
          topLevelComment: { snippet: { textOriginal: text } },
        },
      }),
    });
    if (!res.ok) await this.fail(res, "YouTube comment post");
    const body: any = await res.json().catch(() => null);
    const id = body?.id ?? body?.snippet?.topLevelComment?.id;
    if (!id) throw new Error("YouTube comment post returned no comment id");
    return { commentId: String(id) };
  }

  /**
   * SU8 — set a video's custom thumbnail (thumbnails.set): the
   * image BYTES are the raw request body with the image's own
   * Content-Type. Google's errors propagate verbatim (fail()).
   */
  async setThumbnail(accessToken: string, videoId: string, bytes: Buffer, contentType: string): Promise<void> {
    const res = await this.fetchFn(
      `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": contentType,
        },
        body: bytes,
      },
    );
    if (!res.ok) await this.fail(res, "YouTube thumbnail set");
  }

  /** Parse a byte-transfer response: 200/201 + resource = done
   * (video id); 308 = incomplete, Range says how far YouTube got
   * ("bytes=0-499" ⇒ 500 bytes held ⇒ resume at offset 500). */
  private async transferResult(res: Response): Promise<{ complete: boolean; videoId?: string; receivedUpTo: number }> {
    if (res.status === 200 || res.status === 201) {
      const body: any = await res.json().catch(() => null);
      if (!body?.id) throw new Error("YouTube upload completed but returned no video id");
      return { complete: true, videoId: String(body.id), receivedUpTo: 0 };
    }
    if (res.status === 308) {
      const range = header(res, "range");
      const m = range ? /bytes=0-(\d+)/.exec(range) : null;
      return { complete: false, receivedUpTo: m ? Number(m[1]) + 1 : 0 };
    }
    return this.fail(res, "YouTube upload");
  }

  /** PUT bytes (or the remaining slice) against the session. */
  async putBytes(sessionUri: string, accessToken: string, bytes: Buffer, offset: number, total: number, contentType: string): Promise<{ complete: boolean; videoId?: string; receivedUpTo: number }> {
    const res = await this.fetchFn(sessionUri, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": contentType,
        "Content-Length": String(bytes.length),
        "Content-Range": `bytes ${offset}-${offset + bytes.length - 1}/${total}`,
      },
      body: bytes,
    });
    return this.transferResult(res);
  }

  /** The protocol's status query: a zero-byte PUT with
   * "Content-Range: bytes \*\/total" — 308 + Range while the
   * upload is incomplete, the finished resource once complete. */
  async queryStatus(sessionUri: string, accessToken: string, total: number): Promise<{ complete: boolean; videoId?: string; receivedUpTo: number }> {
    const res = await this.fetchFn(sessionUri, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Length": "0",
        "Content-Range": `bytes */${total}`,
      },
    });
    return this.transferResult(res);
  }
}

/**
 * PP2 — where upload bytes come from: bounded range reads over a
 * known total size. Production backs this with MediaStore range
 * reads; tests back it with a Buffer. At most one chunk
 * (YOUTUBE_UPLOAD_CHUNK_BYTES) is ever in memory.
 */
export interface YouTubeByteSource {
  size: number;
  contentType: string;
  readRange(offset: number, length: number): Promise<Buffer>;
}

/** 8 MiB — a multiple of YouTube's 256 KiB chunk granularity. */
export const YOUTUBE_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Upload orchestration: initiate → PUT the bytes in chunks → on
 * a mid-way failure, QUERY THE SESSION before touching it again
 * (the protocol's rule — the first PUTs may have partially
 * landed, or even completed despite the error), then resume ONCE
 * from the exact offset YouTube reports. A final failure throws
 * Google's verbatim error; SP5's retry then starts a fresh
 * session.
 */
export class YouTubePublisher {
  private readonly client: YouTubeClient;

  constructor(client: YouTubeClient = new YouTubeClient()) {
    this.client = client;
  }

  /** SU8: cover/thumbnail pass-through (client owns the HTTP). */
  async setThumbnail(accessToken: string, videoId: string, bytes: Buffer, contentType: string): Promise<void> {
    return this.client.setThumbnail(accessToken, videoId, bytes, contentType);
  }

  /** SN1 pass-throughs (client owns the HTTP). */
  async listPlaylists(accessToken: string): Promise<YouTubePlaylist[]> {
    return this.client.listPlaylists(accessToken);
  }

  async addToPlaylist(accessToken: string, playlistId: string, videoId: string): Promise<void> {
    return this.client.addToPlaylist(accessToken, playlistId, videoId);
  }

  async postComment(accessToken: string, videoId: string, text: string): Promise<{ commentId: string }> {
    return this.client.postComment(accessToken, videoId, text);
  }

  /** SP9's original Buffer entry point, kept for its callers and
   * specs: a thin source over the in-memory bytes. */
  async upload(args: {
    accessToken: string; bytes: Buffer; contentType: string; title: string; description: string;
    tags?: string[]; categoryId?: string;
  }): Promise<{ videoId: string }> {
    const { bytes, contentType, ...rest } = args;
    return this.uploadFromSource({
      ...rest,
      source: {
        size: bytes.length,
        contentType,
        readRange: async (offset: number, length: number) => bytes.subarray(offset, Math.min(offset + length, bytes.length)),
      },
    });
  }

  async uploadFromSource(args: {
    accessToken: string; source: YouTubeByteSource; title: string; description: string;
    tags?: string[]; categoryId?: string;
  }): Promise<{ videoId: string }> {
    const total = args.source.size;
    const session = await this.client.initiateResumable(args.accessToken, {
      title: args.title, description: args.description,
      contentType: args.source.contentType, contentLength: total,
      tags: args.tags, categoryId: args.categoryId,
    });
    let firstError: unknown = null;
    try {
      return await this.sendFrom(session, args, 0);
    } catch (e) {
      firstError = e;
    }
    // Mid-upload failure: ask the session what actually landed
    // BEFORE deciding — the upload may already be complete.
    const status = await this.client.queryStatus(session, args.accessToken, total).catch(() => null);
    if (status?.complete && status.videoId) return { videoId: status.videoId };
    if (status) return this.sendFrom(session, args, status.receivedUpTo);
    // The session itself is gone/unreadable — surface the
    // ORIGINAL failure verbatim rather than inventing one.
    throw firstError instanceof Error ? firstError : new Error("YouTube upload failed");
  }

  /** Send chunks from `fromOffset` until YouTube holds every byte
   * (or returns the finished resource). A 308 advances the offset
   * to what YouTube reports; two consecutive non-advancing 308s
   * mean the session is stuck and fail honestly instead of
   * looping forever. */
  private async sendFrom(session: string, args: { accessToken: string; source: YouTubeByteSource }, fromOffset: number): Promise<{ videoId: string }> {
    const total = args.source.size;
    let offset = Math.min(Math.max(fromOffset, 0), total);
    let stalls = 0;
    while (offset < total) {
      const length = Math.min(YOUTUBE_UPLOAD_CHUNK_BYTES, total - offset);
      const chunk = await args.source.readRange(offset, length);
      if (!chunk || chunk.length === 0) {
        throw new Error("YouTube upload ব্যর্থ — Storage থেকে ভিডিওর bytes পড়া যাচ্ছে না।");
      }
      const r = await this.client.putBytes(session, args.accessToken, chunk, offset, total, args.source.contentType);
      if (r.complete && r.videoId) return { videoId: r.videoId };
      if (r.receivedUpTo <= offset) {
        stalls += 1;
        if (stalls >= 2) {
          throw new Error(`YouTube upload সম্পন্ন হয়নি — সেশন বলছে ${r.receivedUpTo}/${total} bytes পৌঁছেছে। আবার চেষ্টা করলে নতুন সেশনে আপলোড হবে।`);
        }
      } else {
        stalls = 0;
      }
      offset = r.receivedUpTo;
    }
    // Every byte is held but no resource came back on the data
    // PUTs — the protocol's status query returns the resource.
    const status = await this.client.queryStatus(session, args.accessToken, total);
    if (status.complete && status.videoId) return { videoId: status.videoId };
    throw new Error(`YouTube upload সম্পন্ন হয়নি — সেশন বলছে ${status.receivedUpTo}/${total} bytes পৌঁছেছে। আবার চেষ্টা করলে নতুন সেশনে আপলোড হবে।`);
  }
}
