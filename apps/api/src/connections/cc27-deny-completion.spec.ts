process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "cc27-spec-secret";

import { ForbiddenException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { ConnectionsService } from "./connections.service";
import { SocialService } from "../social/social.service";
import { SocialPublishService } from "../social/social-publish.service";
import { SocialCommentsService } from "../inbox/social-comments.service";
import { InboxService } from "../inbox/inbox.service";
import { MessagingService } from "../messaging/messaging.service";
import { AdsService } from "../ads/ads.service";
import { CampaignsService } from "../campaigns/campaigns.service";
import { encryptJson } from "../integrations/crypto";

/**
 * CC27 (Connect Center Next) — deny-list completion.
 *
 * Pins, per path, the actor rule from
 * docs/connect-center-b12-acceptance.md:
 *  - member-access matrix: AdAccount ids are deniable targets;
 *  - scheduled social sweep: the post AUTHOR is re-checked at
 *    publish time (denied after scheduling → back to draft with
 *    the reason on the post + audit; the publisher never runs);
 *  - comments: human replies (incl. bulk AI-reply) check the
 *    ACTING member against the Integration the reply would
 *    leave through; AI auto-reply checks the settings'
 *    CONFIGURING actor (SocialReplySetting.updatedById);
 *  - inbox: AI auto-reply + the sendAutomatedMessage funnel
 *    check assignee ?? settings configuring actor;
 *  - broadcasts: the WhatsApp sweep re-checks the CREATOR at
 *    send time (entries fail with the deny reason; nothing is
 *    sent);
 *  - ads: manual sync triggers refuse a denied member BEFORE a
 *    platform client exists; the scheduled job path (fromJob)
 *    is deliberately NOT gated;
 *  - campaigns: publish + ACTIVE transitions refuse a denied
 *    member; PAUSED is never gated (stopping spend is safety).
 * Everywhere: OWNER is never denied (helper semantics).
 */

const ORG = "org-cc27";
const OWNER = "user-owner";
const MEMBER = "user-member";
const CONFIGURATOR = "user-configurator";

// All Graph/provider HTTP in these paths must fail fast and
// deterministically — the specs assert on the RECORDS, and a
// control path "reaching the provider attempt" is proven by
// the provider error being recorded, never by a live call.
const realFetch = global.fetch;
beforeAll(() => {
  (global as any).fetch = jest.fn(async () => { throw new Error("network disabled in cc27 spec"); });
});
afterAll(() => { (global as any).fetch = realFetch; });

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((w) => matches(row, w));
    if (k === "AND") return (v as any[]).every((w) => matches(row, w));
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) {
        const n = (v as any).not;
        if (n === null) { if (row[k] === null || row[k] === undefined) return false; }
        else if (n !== null && typeof n === "object" && "in" in n) { if (n.in.includes(row[k])) return false; }
        else if (row[k] === n) return false;
      }
      if ("in" in v && !(v as any).in.includes(row[k])) return false;
      if ("lte" in v && !(new Date(row[k]).getTime() <= new Date((v as any).lte).getTime())) return false;
      if ("lt" in v && !(new Date(row[k]).getTime() < new Date((v as any).lt).getTime())) return false;
      if ("gte" in v && !(new Date(row[k]).getTime() >= new Date((v as any).gte).getTime())) return false;
      if ("gt" in v && !(new Date(row[k]).getTime() > new Date((v as any).gt).getTime())) return false;
      if (!("not" in v) && !("in" in v) && !("lte" in v) && !("lt" in v) && !("gte" in v) && !("gt" in v)) {
        // one-level nested (relation-ish) filter: compare subfields
        return Object.entries(v).every(([sk, sv]) => row[k]?.[sk] === sv || row[`${k}Id`] === (v as any).id);
      }
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

function sortRows(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  for (const spec of specs.reverse()) {
    const [field, dir] = Object.entries(spec)[0] as [string, string];
    out.sort((a, b) => {
      const av = a[field] instanceof Date ? a[field].getTime() : a[field];
      const bv = b[field] instanceof Date ? b[field].getTime() : b[field];
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === "desc" ? -cmp : cmp;
    });
  }
  return out;
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  const applyInclude = (row: any, include: any) => row; // fixtures carry joined fields inline
  return {
    rows,
    findFirst: async ({ where, orderBy }: any = {}) => sortRows(rows.filter((r) => matches(r, where ?? {})), orderBy)[0] ?? null,
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      let out = sortRows(rows.filter((r) => matches(r, where ?? {})), orderBy);
      if (skip) out = out.slice(skip);
      if (take) out = out.slice(0, take);
      return out;
    },
    findUnique: async ({ where }: any) => {
      const keys = Object.keys(where ?? {});
      // Prisma compound-unique shape: { userId_organizationId: { userId, organizationId } }
      if (keys.length === 1 && where[keys[0]] !== null && typeof where[keys[0]] === "object" && !(where[keys[0]] instanceof Date) && !("in" in where[keys[0]]) && !("not" in where[keys[0]])) {
        const inner = where[keys[0]];
        return rows.find((r) => Object.entries(inner).every(([k, v]) => r[k] === v)) ?? null;
      }
      return rows.find((r) => matches(r, where ?? {})) ?? null;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where ?? {}));
      if (row) { Object.assign(row, data); row.updatedAt = new Date(); }
      return row ?? null;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows) if (matches(row, where ?? {})) { Object.assign(row, data); count++; }
      return { count };
    },
    upsert: async ({ where, create, update }: any) => {
      const existing = rows.find((r) => matches(r, where ?? {}));
      if (existing) { Object.assign(existing, update); return existing; }
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(row);
      return row;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => matches(r, where ?? {}));
      if (i >= 0) rows.splice(i, 1);
      return {};
    },
    deleteMany: async ({ where }: any = {}) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where ?? {})) { rows.splice(i, 1); count++; }
      return { count };
    },
  };
}

function makeDb(tableNames: string[]) {
  const db: any = {};
  for (const n of tableNames) db[n] = makeTable(n);
  return db;
}

function makeAudit() {
  const entries: any[] = [];
  return { entries, audit: { log: jest.fn(async (input: any) => { entries.push(input); }) } };
}

function memberRow(userId: string, role: string, deniedConnections: string[] = []) {
  return { id: `mem-${userId}`, organizationId: ORG, userId, role, status: "ACTIVE", deniedConnections, areas: null };
}

describe("CC27 member-access matrix — ad accounts are deniable targets", () => {
  function build() {
    const db = makeDb(["membership", "integration", "socialAccount", "adAccount", "user", "tenantAppConfig", "auditLog"]);
    db.membership.rows.push(memberRow(OWNER, "OWNER"), memberRow(MEMBER, "MEMBER"));
    db.user.rows.push({ id: OWNER, name: "Owner", email: "o@x.co" }, { id: MEMBER, name: "Member", email: "m@x.co" });
    db.integration.rows.push({ id: "int-1", organizationId: ORG, provider: "whatsapp", status: "CONNECTED", label: null, groupName: null, createdAt: new Date() });
    db.socialAccount.rows.push({ id: "soc-1", organizationId: ORG, platform: "facebook", name: "Page One", label: null, groupName: null, createdAt: new Date() });
    db.adAccount.rows.push({ id: "ad-1", organizationId: ORG, platform: "meta", name: "Main Ads", label: null, groupName: null, createdAt: new Date() });
    const { audit, entries } = makeAudit();
    const svc = new ConnectionsService(db as any, audit as any);
    return { db, svc, entries };
  }

  it("the matrix lists the ad account as a target with source ad_account", async () => {
    const { svc } = build();
    const matrix: any = await svc.getMemberAccessMatrix(ORG);
    const target = matrix.targets.find((t: any) => t.id === "ad-1");
    expect(target).toMatchObject({ source: "ad_account", category: "ads", provider: "meta", displayName: "Main Ads" });
  });

  it("an ad account id can be saved into a member's deny-list (and an unknown id is still refused)", async () => {
    const { svc, db } = build();
    await svc.setMemberDeniedConnections(ORG, OWNER, MEMBER, ["ad-1", "int-1"]);
    expect(db.membership.rows.find((m: any) => m.userId === MEMBER).deniedConnections).toEqual(["ad-1", "int-1"]);
    await expect(svc.setMemberDeniedConnections(ORG, OWNER, MEMBER, ["no-such-id"])).rejects.toThrow(/পাওয়া যায়নি/);
  });
});

describe("CC27 scheduled social sweep — author re-checked at publish time", () => {
  function build(denied: boolean) {
    const db = makeDb(["socialPost", "socialPostVariant", "socialAccount", "organization", "membership", "integration"]);
    db.organization.rows.push({ id: ORG, timezone: "Asia/Dhaka", socialRequireApproval: false });
    db.membership.rows.push(memberRow(MEMBER, "MEMBER", denied ? ["soc-1"] : []));
    db.socialAccount.rows.push({ id: "soc-1", organizationId: ORG, platform: "facebook", status: "CONNECTED", name: "Page One" });
    db.socialPost.rows.push({
      id: "post-1", organizationId: ORG, socialAccountId: "soc-1", createdById: MEMBER,
      status: "scheduled", scheduledAt: new Date(Date.now() - 60_000), platform: "facebook",
      caption: "ঈদের অফার", mediaRefs: [], attempts: 0, approvalStatus: null, error: null,
    });
    const { audit, entries } = makeAudit();
    const social = new SocialService(db as any, audit as any);
    const publish = new SocialPublishService(db as any, audit as any, social);
    const publishFn = jest.fn(async () => ({ platformPostId: "page_777", platformUrl: null }));
    (publish as any).publishToPlatform = publishFn;
    return { db, publish, publishFn, entries };
  }

  it("author denied AFTER scheduling → post returns to draft with the reason, publisher never runs, refusal audited", async () => {
    const { db, publish, publishFn, entries } = build(true);
    const counts: any = await publish.runDuePublishes(ORG);
    expect(publishFn).not.toHaveBeenCalled();
    expect(counts.blocked).toBe(1);
    expect(counts.published).toBe(0);
    const post = db.socialPost.rows[0];
    expect(post.status).toBe("draft");
    expect(post.scheduledAt).toBeNull();
    expect(post.error).toContain("প্রত্যাহার");
    expect(entries.some((e: any) => e.action === "social.post_publish_denied")).toBe(true);
  });

  it("control: author not denied → the due post publishes", async () => {
    const { db, publish, publishFn } = build(false);
    const counts: any = await publish.runDuePublishes(ORG);
    expect(publishFn).toHaveBeenCalledTimes(1);
    expect(counts.published).toBe(1);
    expect(db.socialPost.rows[0].status).toBe("published");
  });
});

describe("CC27 comment replies — acting member + configuring actor", () => {
  function build(opts: { humanDenied?: boolean; settingsActor?: string | null; settingsActorDenied?: boolean }) {
    const db = makeDb(["socialComment", "socialReplySetting", "integration", "membership", "product"]);
    db.integration.rows.push({
      id: "int-fb", organizationId: ORG, provider: "messenger", status: "CONNECTED", createdAt: new Date(),
      credential: { encryptedData: encryptJson({ accessToken: "tok-1" }) },
    });
    db.membership.rows.push(
      memberRow(MEMBER, "MEMBER", opts.humanDenied ? ["int-fb"] : []),
      memberRow(CONFIGURATOR, "MEMBER", opts.settingsActorDenied ? ["int-fb"] : []),
    );
    db.socialReplySetting.rows.push({
      id: "crs-1", organizationId: ORG, aiAutoReplyEnabled: true, sendPrivateDm: false,
      autoHideSpam: false, replyDelaySeconds: 0, tonePreference: "FRIENDLY_SALES",
      bannedKeywords: [], nightOwlEnabled: false, urgentAlertTelegramEnabled: false,
      cannedSnippets: [], updatedById: opts.settingsActor ?? null,
    });
    db.socialComment.rows.push({
      id: "cmt-1", organizationId: ORG, platform: "facebook", status: "PENDING",
      commentText: "দাম কত?", authorName: "Rahim", externalCommentId: "ext-1",
      aiReplyDueAt: new Date(Date.now() - 60_000), aiReplyAttempts: 0,
      metadata: {}, isPrivateDmSent: false,
    });
    const { audit, entries } = makeAudit();
    const svc = new SocialCommentsService(db as any, audit as any);
    return { db, svc, entries };
  }

  it("human reply by a denied member → Forbidden before any Graph call; the comment is untouched", async () => {
    const { db, svc } = build({ humanDenied: true });
    await expect(svc.sendReply(ORG, MEMBER, "cmt-1", { replyText: "দাম ৫০০ টাকা" } as any)).rejects.toBeInstanceOf(ApiException);
    const c = db.socialComment.rows[0];
    expect(c.status).toBe("PENDING");
    expect(c.metadata?.graph?.replyId).toBeUndefined();
  });

  it("control: human reply by an allowed member reaches the Graph attempt (provider error surfaces, not a deny)", async () => {
    const { svc } = build({ humanDenied: false });
    // fetch is disabled in this spec → the Graph attempt itself
    // fails with the network error — proof the gate let the send
    // through to the provider boundary.
    await expect(svc.sendReply(ORG, MEMBER, "cmt-1", { replyText: "দাম ৫০০ টাকা" } as any)).rejects.toThrow(/network disabled in cc27 spec/);
  });

  it("bulk AI_REPLY_ALL by a denied member → the item lands in failed[] with the deny reason; nothing sent", async () => {
    const { svc } = build({ humanDenied: true });
    const res: any = await svc.executeBulkAction(ORG, MEMBER, ["cmt-1"], "AI_REPLY_ALL");
    expect(res.affected).toBe(0);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].error).toContain("অনুমতি");
  });

  it("AI sweep: the settings' configuring actor is denied → reply suppressed, recorded on the comment, stays PENDING for a human", async () => {
    const { db, svc, entries } = build({ settingsActor: CONFIGURATOR, settingsActorDenied: true });
    const counts: any = await svc.runDueCommentReplies(ORG);
    expect(counts.fired).toBe(0);
    expect(counts.skipped).toBe(1);
    const c = db.socialComment.rows[0];
    expect(c.status).toBe("PENDING");
    expect(c.metadata?.graph?.denySuppressed?.reason).toBe("settings_actor_connection_denied");
    expect(entries.some((e: any) => e.action === "social_comments.ai_reply_suppressed_denied")).toBe(true);
  });

  it("AI sweep control: no recorded configuring actor → NOT gated (no actor exists); the reply is attempted", async () => {
    const { db, svc } = build({ settingsActor: null });
    await svc.runDueCommentReplies(ORG);
    const c = db.socialComment.rows[0];
    expect(c.metadata?.graph?.denySuppressed).toBeUndefined();
    // the attempt happened and the provider failure was recorded
    expect(c.metadata?.graph?.replyError ?? "").toBeTruthy();
  });

  it("updateSettings records the configuring actor on the row (the CC27 actor source)", async () => {
    const { db, svc } = build({ settingsActor: null });
    await svc.updateSettings(ORG, CONFIGURATOR, { tonePreference: "FORMAL" } as any);
    expect(db.socialReplySetting.rows[0].updatedById).toBe(CONFIGURATOR);
  });
});

describe("CC27 inbox autopilot + system sends — assignee ?? configuring actor", () => {
  function build(opts: { assignee?: string | null; settingsActor?: string | null; deniedFor: string[] }) {
    const db = makeDb(["channelConversation", "channelMessage", "inboxSetting", "membership", "integration", "unansweredQuestion", "customer"]);
    db.membership.rows.push(
      memberRow(MEMBER, "MEMBER", opts.deniedFor.includes(MEMBER) ? ["int-1"] : []),
      memberRow(CONFIGURATOR, "MEMBER", opts.deniedFor.includes(CONFIGURATOR) ? ["int-1"] : []),
    );
    db.inboxSetting.rows.push({
      id: "iset-1", organizationId: ORG, autoReplyMode: "auto", perIntent: {}, perChannelModes: {},
      confidenceThreshold: 70, nightOwlEnabled: false, workingHoursEnabled: false,
      aiReplySchedule: null, updatedById: opts.settingsActor ?? null,
    });
    db.channelConversation.rows.push({
      id: "conv-1", organizationId: ORG, channel: "messenger", integrationId: "int-1",
      assignedUserId: opts.assignee ?? null, autoReplyPaused: false, status: "open",
      customerId: "cust-1", unreadCount: 1, metadata: {},
    });
    const { audit, entries } = makeAudit();
    const llm = { getProvider: jest.fn(() => null) };
    const svc = new InboxService(db as any, audit as any, llm as any);
    return { db, svc, entries, llm };
  }
  const classification = { intent: "price", confidence: 95, sentiment: "neutral", needsHuman: false, isSpam: false, language: "bn" } as any;

  it("assignee denied → AI reply suppressed; the conversation is escalated to a human with the recorded reason", async () => {
    const { db, svc, entries, llm } = build({ assignee: MEMBER, deniedFor: [MEMBER] });
    await (svc as any).maybeAutoReply(ORG, db.channelConversation.rows[0], classification, "দাম কত?");
    const conv = db.channelConversation.rows[0];
    expect(conv.autoReplyPaused).toBe(true);
    expect(conv.handoverReason).toBe("connection_denied");
    expect(db.channelMessage.rows).toHaveLength(0);
    expect(llm.getProvider).not.toHaveBeenCalled();
    expect(entries.some((e: any) => e.action === "inbox.autopilot.escalated" && e.metadata?.reason === "connection_denied")).toBe(true);
  });

  it("no assignee → the settings' configuring actor governs (denied → same suppression)", async () => {
    const { db, svc } = build({ assignee: null, settingsActor: CONFIGURATOR, deniedFor: [CONFIGURATOR] });
    await (svc as any).maybeAutoReply(ORG, db.channelConversation.rows[0], classification, "দাম কত?");
    expect(db.channelConversation.rows[0].handoverReason).toBe("connection_denied");
    expect(db.channelMessage.rows).toHaveLength(0);
  });

  it("assignee takes precedence: an ALLOWED assignee is not blocked by a denied configuring actor", async () => {
    const { db, svc } = build({ assignee: MEMBER, settingsActor: CONFIGURATOR, deniedFor: [CONFIGURATOR] });
    // low confidence → the flow exits via the unanswered-question
    // record — anything EXCEPT the deny escalation proves the
    // gate passed on the assignee's (clean) list.
    await (svc as any).maybeAutoReply(ORG, db.channelConversation.rows[0], { ...classification, confidence: 10 }, "দাম কত?");
    expect(db.channelConversation.rows[0].handoverReason ?? null).not.toBe("connection_denied");
  });

  it("sendAutomatedMessage (the system-send funnel): denied governing actor → Forbidden, no message row, refusal audited", async () => {
    const { db, svc, entries } = build({ assignee: MEMBER, deniedFor: [MEMBER] });
    await expect(svc.sendAutomatedMessage(ORG, "conv-1", "আপনার অর্ডারটি পাঠানো হয়েছে", "courier_update")).rejects.toBeInstanceOf(ApiException);
    expect(db.channelMessage.rows).toHaveLength(0);
    expect(entries.some((e: any) => e.action === "inbox.system_send.suppressed_denied")).toBe(true);
  });

  it("sendAutomatedMessage control: allowed actor passes the gate (and then fails honestly on the missing integration)", async () => {
    const { svc } = build({ assignee: MEMBER, deniedFor: [] });
    await expect(svc.sendAutomatedMessage(ORG, "conv-1", "hello", "courier_update")).rejects.toMatchObject({ code: "inbox.noConnectedIntegrationForThisOrganization2" });
  });

  it("updateSettings records the configuring actor on InboxSetting (the CC27 fallback actor source)", async () => {
    const { db, svc } = build({ deniedFor: [] });
    await svc.updateSettings(ORG, CONFIGURATOR, { autoReplyMode: "auto" } as any);
    expect(db.inboxSetting.rows[0].updatedById).toBe(CONFIGURATOR);
    const view: any = await svc.getSettings(ORG);
    expect(view.updatedById).toBe(CONFIGURATOR);
  });
});

describe("CC27 WhatsApp broadcasts — creator re-checked at send time", () => {
  function build(creatorDenied: boolean) {
    const db = makeDb(["broadcast", "integration", "whatsAppTemplate", "messagePreference", "messagingSetting", "membership", "messageDelivery", "customer", "lead"]);
    db.membership.rows.push(memberRow(MEMBER, "MEMBER", creatorDenied ? ["wa-1"] : []));
    db.integration.rows.push({
      id: "wa-1", organizationId: ORG, provider: "whatsapp", status: "CONNECTED",
      credential: { encryptedData: encryptJson({ accessToken: "tok", phoneNumberId: "12345" }) },
    });
    db.whatsAppTemplate.rows.push({ id: "tpl-1", organizationId: ORG, name: "eid_offer", language: "bn", status: "APPROVED" });
    db.broadcast.rows.push({
      id: "bc-1", organizationId: ORG, channel: "whatsapp", status: "sending", createdById: MEMBER,
      whatsappTemplateId: "tpl-1", subject: null, body: "অফার",
      recipientSnapshot: [{ key: "customer:c1", type: "customer", id: "c1", phone: "01712345678", status: "pending", attempts: 0 }],
      totalRecipients: 1, sentCount: 0, failedCount: 0, progressCursor: 0,
    });
    const { audit, entries } = makeAudit();
    const email = { isConfigured: () => true, send: jest.fn(async () => ({ providerMessageId: "x" })) } as any;
    const sms = { isConfigured: () => false, send: jest.fn(async () => { throw new Error("no sms"); }) } as any;
    const svc = new MessagingService(db as any, audit as any, email, sms);
    return { db, svc, entries };
  }

  it("creator denied after creation → every entry fails with the deny reason and nothing is sent", async () => {
    const { db, svc } = build(true);
    const res: any = await svc.processBroadcast(ORG, "bc-1", { chunkSize: 10 });
    expect(res.sent).toBe(0);
    expect(res.failed).toBe(1);
    const bc = db.broadcast.rows[0];
    expect(bc.recipientSnapshot[0].status).toBe("failed");
    expect(bc.recipientSnapshot[0].error).toContain("প্রত্যাহার");
  });

  it("createWhatsAppSender: denied creator → Forbidden; allowed creator → a sender is built", async () => {
    const denied = build(true);
    await expect((denied.svc as any).createWhatsAppSender(ORG, denied.db.broadcast.rows[0], "bc-1", MEMBER)).rejects.toBeInstanceOf(ApiException);
    const allowed = build(false);
    const sender = await (allowed.svc as any).createWhatsAppSender(ORG, allowed.db.broadcast.rows[0], "bc-1", MEMBER);
    expect(typeof sender).toBe("function");
  });
});

describe("CC27 ad syncs — manual gated, scheduled job not gated", () => {
  function build(denied: boolean) {
    const db = makeDb(["adAccount", "membership", "integration"]);
    db.membership.rows.push(memberRow(MEMBER, "MEMBER", denied ? ["ad-1", "ad-2"] : []));
    db.adAccount.rows.push(
      { id: "ad-1", organizationId: ORG, platform: "meta", sourceType: "api", integrationId: null, externalId: "act_1", syncDisabled: false, name: "Main" },
      { id: "ad-2", organizationId: ORG, platform: "google", sourceType: "api", integrationId: null, externalId: "123-456", syncDisabled: false, name: "G" },
    );
    const { audit } = makeAudit();
    const svc = new AdsService(db as any, audit as any);
    return { db, svc };
  }

  it("manual Meta sync by a denied member → Forbidden before any platform work", async () => {
    const { svc } = build(true);
    await expect(svc.syncMetaInsights(ORG, MEMBER, "ad-1", {})).rejects.toBeInstanceOf(ApiException);
    await expect(svc.syncMetaAdInsights(ORG, MEMBER, "ad-1", {})).rejects.toBeInstanceOf(ApiException);
    await expect(svc.syncMetaBreakdowns(ORG, MEMBER, "ad-1", {})).rejects.toBeInstanceOf(ApiException);
  });

  it("manual Google sync by a denied member → Forbidden (deny is checked against the account, whatever its platform)", async () => {
    const { svc } = build(true);
    await expect(svc.syncGoogleInsights(ORG, MEMBER, "ad-2", {})).rejects.toThrow(/এই বিজ্ঞাপন অ্যাকাউন্টের ডেটা Sync/);
  });

  it("control: allowed member passes the gate and fails honestly downstream (account not API-connected)", async () => {
    const { svc } = build(false);
    await expect(svc.syncMetaInsights(ORG, MEMBER, "ad-1", {})).rejects.toMatchObject({ code: "ads.thisAdAccountIsNotConnected" });
  });

  it("the SCHEDULED job path is deliberately not deny-gated (documented): same member, job entry → downstream error, not a deny", async () => {
    const { svc } = build(true);
    await expect(svc.syncInsightsJob("meta", ORG, MEMBER, "ad-1")).rejects.toMatchObject({ code: "ads.thisAdAccountIsNotConnected" });
  });

  it("sync-all records a denied account as skipped_denied and still attempts the others", async () => {
    const db = makeDb(["adAccount", "membership", "integration"]);
    db.membership.rows.push(memberRow(MEMBER, "MEMBER", ["ad-1"]));
    db.adAccount.rows.push(
      { id: "ad-1", organizationId: ORG, platform: "meta", sourceType: "api", integrationId: "int-x", externalId: "act_1", syncDisabled: false, name: "Denied" },
      { id: "ad-3", organizationId: ORG, platform: "meta", sourceType: "api", integrationId: "int-y", externalId: "act_3", syncDisabled: false, name: "Allowed" },
    );
    const { audit } = makeAudit();
    const svc = new AdsService(db as any, audit as any);
    const out: any = await svc.syncAllAccounts(ORG, MEMBER);
    const byId = Object.fromEntries(out.results.map((r: any) => [r.accountId, r.status]));
    expect(byId["ad-1"]).toBe("skipped_denied");
    expect(byId["ad-3"]).toBe("failed"); // attempted; its integration row is absent → honest failure
  });
});

describe("CC27 campaigns — publish/activate gated, pause never gated", () => {
  function build(denied: boolean) {
    const db = makeDb(["campaignPlan", "membership", "adAccount", "integration", "campaignAdSet", "campaignAd", "campaignPublishLog"]);
    db.membership.rows.push(memberRow(MEMBER, "MEMBER", denied ? ["ad-1"] : []));
    db.adAccount.rows.push({ id: "ad-1", organizationId: ORG, platform: "meta", integrationId: "int-1", externalId: "act_1", name: "Main" });
    db.integration.rows.push({
      id: "int-1", organizationId: ORG, provider: "meta", status: "CONNECTED",
      credential: { encryptedData: encryptJson({ accessToken: "tok" }) },
    });
    db.campaignPlan.rows.push({
      id: "plan-1", organizationId: ORG, adAccountId: "ad-1", status: "approved", createdById: MEMBER,
      externalCampaignId: "238001", metaStatus: "PAUSED", name: "Eid",
    });
    const { audit } = makeAudit();
    const llm = { getProvider: () => null } as any;
    const publishing = { createGoogleCampaign: jest.fn(async () => ({})), createTikTokCampaign: jest.fn(async () => ({})) } as any;
    const svc = new CampaignsService(db as any, audit as any, llm, publishing);
    return { db, svc, publishing };
  }

  it("publish by a denied member → Forbidden; the plan never leaves approved", async () => {
    const { db, svc } = build(true);
    await expect(svc.publish(ORG, MEMBER, "plan-1")).rejects.toBeInstanceOf(ApiException);
    expect(db.campaignPlan.rows[0].status).toBe("approved");
  });

  it("publish control: allowed member on a non-approved plan gets the APPROVAL refusal, not the deny refusal", async () => {
    const { db, svc } = build(false);
    db.campaignPlan.rows[0].status = "draft";
    await expect(svc.publish(ORG, MEMBER, "plan-1")).rejects.toMatchObject({ code: "campaigns.planMustBeApprovedBeforePublishing" });
  });

  it("ACTIVATE by a denied member → Forbidden; PAUSE by the same denied member is NOT gated (reaches the Meta attempt)", async () => {
    const { db, svc } = build(true);
    db.campaignPlan.rows[0].status = "published"; // setMetaStatus operates on published plans
    await expect(svc.setMetaStatus(ORG, MEMBER, "plan-1", "ACTIVE")).rejects.toBeInstanceOf(ApiException);
    // pause: the gate is skipped by design → publishClient builds
    // → Meta call attempted → provider failure surfaces verbatim.
    await expect(svc.setMetaStatus(ORG, MEMBER, "plan-1", "PAUSED")).rejects.toThrow(/Meta did NOT confirm/);
  });

  it("cross-platform draft onto a denied target account → Forbidden before the publishing service is touched", async () => {
    const { svc, publishing } = build(true);
    await expect(svc.crossPlatformDraft(ORG, "plan-1", MEMBER, { platform: "meta" as any, targetAdAccountId: "ad-1" })).rejects.toMatchObject({ code: "campaigns.platformMustBeGoogleOrTiktok" });
    // google target: seed a google account denied for the member
    const { db } = { db: (svc as any).prisma };
    db.adAccount.rows.push({ id: "ad-g1", organizationId: ORG, platform: "google", integrationId: "int-1", externalId: "123", name: "G" });
    db.membership.rows[0].deniedConnections = ["ad-g1"];
    await expect(svc.crossPlatformDraft(ORG, "plan-1", MEMBER, { platform: "google", targetAdAccountId: "ad-g1" })).rejects.toBeInstanceOf(ApiException);
    expect(publishing.createGoogleCampaign).not.toHaveBeenCalled();
  });
});
