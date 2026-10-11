import { Injectable, Logger, MessageEvent } from "@nestjs/common";
import { Observable, Subject, interval, merge } from "rxjs";
import { map } from "rxjs/operators";
import { parseProductCard } from "./product-card";

/**
 * Realtime inbox transport (Unified Inbox U1 + U6).
 *
 * In-process pub/sub fanning out Server-Sent Events per
 * organization. Since U6, when REDIS_URL is configured the
 * fan-out crosses API instances: emit() publishes to the Redis
 * channel `inbox-events` and delivery happens through each
 * instance's subscription (including the emitter's own), so all
 * replicas show the same stream. Without REDIS_URL — or if
 * Redis fails — emit() delivers locally; messaging never
 * depends on realtime. Presence stays instance-ephemeral by
 * design (the DB AgentPresence heartbeat is the durable
 * cross-instance record).
 */
export interface InboxRealtimeEvent {
  type: "message.created" | "conversation.updated" | "presence" | "notification" | "visitor.presence";
  conversationId?: string;
  message?: unknown;
  patch?: Record<string, unknown>;
  userId?: string;
  userName?: string;
  typing?: boolean;
  /** Inbox Next-Gen P3: a webchat visitor's typing state, carried
   * on "visitor.presence" events to the AGENT stream. */
  visitorTyping?: boolean;
  at: string;
}

interface PresenceEntry { userId: string; userName?: string; typing: boolean; at: number }

/** Minimal pub/sub transport the Redis bridge needs — ioredis
 * clients satisfy it, and tests inject a fake bus. */
export interface RealtimeBus {
  publish(channel: string, payload: string): Promise<number>;
  subscribe(channel: string, handler: (payload: string) => void): Promise<void>;
}

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger("RealtimeService");
  private readonly subjects = new Map<string, Set<Subject<MessageEvent>>>();
  private readonly presence = new Map<string, Map<string, PresenceEntry>>();
  private bus: RealtimeBus | null = null;
  private busReady: Promise<void> | null = null;
  static readonly BUS_CHANNEL = "inbox-events";

  async onModuleInit() {
    await this.attachRedisFromEnv();
  }

  /** Attach a cross-instance bus (U6). Called once at boot when
   * REDIS_URL is set; failures degrade to local-only delivery. */
  attachBus(bus: RealtimeBus) {
    this.bus = bus;
    this.busReady = bus.subscribe(RealtimeService.BUS_CHANNEL, (payload) => {
      try {
        const { organizationId, event } = JSON.parse(payload) as { organizationId: string; event: InboxRealtimeEvent };
        if (organizationId && event) this.deliverLocal(organizationId, event);
      } catch { /* a bad frame never breaks the stream */ }
    }).catch((e) => {
      this.logger.warn(`Realtime bus subscribe failed, local-only mode: ${e instanceof Error ? e.message : e}`);
      this.bus = null;
    });
  }

  /** Default production wiring: two ioredis clients (pub + sub)
   * when REDIS_URL exists. Dynamic import keeps ioredis out of
   * the local-only path and out of unit tests. */
  async attachRedisFromEnv() {
    const url = process.env.REDIS_URL;
    if (!url || this.bus) return;
    try {
      const { default: Redis } = await import("ioredis");
      const pub = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true });
      const sub = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true });
      await pub.connect();
      const bus: RealtimeBus = {
        publish: (channel, payload) => pub.publish(channel, payload),
        subscribe: async (channel, handler) => {
          sub.on("message", (ch: string, message: string) => { if (ch === channel) handler(message); });
          await sub.subscribe(channel);
        },
      };
      this.attachBus(bus);
      this.logger.log("Realtime fan-out: Redis bus attached");
    } catch (e) {
      this.logger.warn(`Realtime Redis unavailable, local-only mode: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Subscribe to an organization's inbox event stream (SSE). */
  stream(organizationId: string): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    let set = this.subjects.get(organizationId);
    if (!set) { set = new Set(); this.subjects.set(organizationId, set); }
    set.add(subject);
    const heartbeat = interval(25000).pipe(map(() => ({ type: "heartbeat", data: "" }) as MessageEvent));
    const events = subject.asObservable();
    return new Observable<MessageEvent>((subscriber) => {
      const sub = merge(events, heartbeat).subscribe(subscriber);
      return () => {
        sub.unsubscribe();
        set!.delete(subject);
        if (set!.size === 0) this.subjects.delete(organizationId);
      };
    });
  }

  emit(organizationId: string, event: Omit<InboxRealtimeEvent, "at"> & { at?: string }) {
    const full: InboxRealtimeEvent = { ...event, at: event.at ?? new Date().toISOString() };
    if (this.bus) {
      // Cross-instance: delivery (including to this instance's
      // own subscribers) happens through the subscription, so
      // every replica renders exactly one copy.
      void this.bus.publish(RealtimeService.BUS_CHANNEL, JSON.stringify({ organizationId, event: full }))
        .catch(() => this.deliverLocal(organizationId, full));
      return;
    }
    this.deliverLocal(organizationId, full);
  }

  private deliverLocal(organizationId: string, full: InboxRealtimeEvent) {
    const set = this.subjects.get(organizationId);
    if (set) for (const subject of set) subject.next({ data: full } as MessageEvent);
    this.deliverToVisitor(full);
  }

  // ---------- Milestone 66: webchat visitor streams ----------
  // A visitor's browser subscribes to exactly ONE conversation
  // (derived from their session token, never a client-supplied
  // id). Delivery rides the same path as the org fan-out, so
  // the Redis bus carries it across replicas unchanged.
  private readonly visitorSubjects = new Map<string, Set<Subject<MessageEvent>>>();

  streamVisitor(conversationId: string): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    let set = this.visitorSubjects.get(conversationId);
    if (!set) { set = new Set(); this.visitorSubjects.set(conversationId, set); }
    set.add(subject);
    const heartbeat = interval(25000).pipe(map(() => ({ type: "heartbeat", data: "" }) as MessageEvent));
    const events = subject.asObservable();
    return new Observable<MessageEvent>((subscriber) => {
      const sub = merge(events, heartbeat).subscribe(subscriber);
      return () => {
        sub.unsubscribe();
        set!.delete(subject);
        if (set!.size === 0) this.visitorSubjects.delete(conversationId);
      };
    });
  }

  visitorSubscriberCount(conversationId: string): number {
    return this.visitorSubjects.get(conversationId)?.size ?? 0;
  }

  /** Inbox Next-Gen P3: tell THIS conversation's visitor that the
   * agent is typing (the visitor-ward counterpart of the agent
   * stream's "visitor.presence"). Only webchat can carry this —
   * no other channel exposes a typing signal to customers. Local
   * delivery to the visitor subjects, like deliverToVisitor. */
  notifyVisitorTyping(conversationId: string, typing: boolean) {
    const set = this.visitorSubjects.get(conversationId);
    if (!set || set.size === 0) return;
    const frame = { type: "typing", typing, at: new Date().toISOString() };
    for (const subject of set) subject.next({ data: frame } as MessageEvent);
  }

  /** Forward new messages to the conversation's visitor with a
   * visitor-safe projection only (the exact fields the polling
   * endpoint returns — never internal message metadata). */
  private deliverToVisitor(full: InboxRealtimeEvent) {
    if (full.type !== "message.created" || !full.conversationId) return;
    const set = this.visitorSubjects.get(full.conversationId);
    if (!set || set.size === 0) return;
    const m = (full.message ?? {}) as Record<string, any>;
    const projection = {
      type: "message.created",
      message: {
        id: m.id, direction: m.direction, content: m.content,
        type: m.type, createdAt: m.createdAt,
        // Inbox Next-Gen P2: same product-card marker the polling
        // projection returns (name + price parsed from the composed
        // caption) so streamed cards render identically.
        product: parseProductCard(m),
      },
      at: full.at,
    };
    for (const subject of set) subject.next({ data: projection } as MessageEvent);
  }

  subscriberCount(organizationId: string): number {
    return this.subjects.get(organizationId)?.size ?? 0;
  }

  /** Record ephemeral thread presence and fan it out. */
  notePresence(organizationId: string, conversationId: string, userId: string, typing: boolean, userName?: string) {
    const key = `${organizationId}:${conversationId}`;
    let room = this.presence.get(key);
    if (!room) { room = new Map(); this.presence.set(key, room); }
    room.set(userId, { userId, userName, typing, at: Date.now() });
    this.emit(organizationId, { type: "presence", conversationId, userId, userName, typing });
  }

  /** Fresh viewers of a thread (entries older than 15s are dead). */
  presenceFor(organizationId: string, conversationId: string): { userId: string; userName?: string; typing: boolean }[] {
    const key = `${organizationId}:${conversationId}`;
    const room = this.presence.get(key);
    if (!room) return [];
    const now = Date.now();
    const out: { userId: string; userName?: string; typing: boolean }[] = [];
    for (const [uid, entry] of room) {
      if (now - entry.at > 15000) { room.delete(uid); continue; }
      out.push({ userId: entry.userId, userName: entry.userName, typing: entry.typing });
    }
    if (room.size === 0) this.presence.delete(key);
    return out;
  }
}
