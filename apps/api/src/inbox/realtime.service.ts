import { Injectable, MessageEvent } from "@nestjs/common";
import { Observable, Subject, interval, merge } from "rxjs";
import { map } from "rxjs/operators";

/**
 * Realtime inbox transport (Unified Inbox U1).
 *
 * In-process pub/sub fanning out Server-Sent Events per
 * organization. Single-API-instance by design (the deployment
 * runs one API replica); U6 moves fan-out to Redis when that
 * changes. Presence (who is viewing/typing a thread) is
 * deliberately ephemeral — it lives here, never in the database.
 */
export interface InboxRealtimeEvent {
  type: "message.created" | "conversation.updated" | "presence" | "notification";
  conversationId?: string;
  message?: unknown;
  patch?: Record<string, unknown>;
  userId?: string;
  userName?: string;
  typing?: boolean;
  at: string;
}

interface PresenceEntry { userId: string; userName?: string; typing: boolean; at: number }

@Injectable()
export class RealtimeService {
  private readonly subjects = new Map<string, Set<Subject<MessageEvent>>>();
  private readonly presence = new Map<string, Map<string, PresenceEntry>>();

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
    const set = this.subjects.get(organizationId);
    if (!set || set.size === 0) return;
    const full: InboxRealtimeEvent = { ...event, at: event.at ?? new Date().toISOString() };
    for (const subject of set) subject.next({ data: full } as MessageEvent);
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
