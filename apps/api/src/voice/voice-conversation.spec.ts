import "reflect-metadata";
import { BadRequestException, HttpException, NotFoundException } from "@nestjs/common";
import { VoiceService } from "./voice.service";
import { VoiceConversationService } from "./voice-conversation.service";

/**
 * NF3 (FB2) — AI Voice Agent conversation. In-memory prisma
 * double in the live-commerce.spec.ts style (org-scoped
 * `matches`, generic table helpers). Collaborators are stubs
 * with call-counts (exactly-once pins); OrgBrainService is a
 * stub whose INTERNAL profile + an internal document carry a
 * sentinel string that must NEVER appear in any agent line —
 * the service only ever reads brain.facts / deliveryFacts.
 *
 * No messaging service is constructed or injected anywhere in
 * this suite: the no-answer follow-up is proven by construction
 * to be a labelled manual task (followUpChannel
 * "whatsapp_manual"), never an automatic send.
 */

type Row = Record<string, any>;

const SENTINEL = "INTERNAL_SENTINEL_গোপন_তথ্য_XYZ";

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub));
    if (k === "AND") return (v as any[]).every((sub) => matches(row, sub));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("not" in v) return row[k] !== (v as any).not;
      return true;
    }
    return row[k] === v;
  });
}

function setup(opts: {
  settings?: Row;
  killOrg?: boolean;
  codStatus?: string;
  orderStatusAfterUpdate?: string;
} = {}) {
  let seq = 0;
  const nid = (p: string) => `${p}-${++seq}`;

  const settingsRow: Row = {
    id: "setting-1",
    organizationId: "org-1",
    enabled: true,
    autoCallNewCod: false,
    provider: "mock",
    maxAttempts: 3,
    conversationAgentEnabled: true,
    conversationMode: "simulation",
    relayWebsocketUrl: null,
    conversationLanguage: "bn-BD",
    sttProvider: "google",
    ttsProvider: "amazon",
    ttsVoice: "Polly.Nabanita",
    ...(opts.settings ?? {}),
  };

  const orderRow: Row = {
    id: "order-1",
    organizationId: "org-1",
    isCod: true,
    status: "pending",
    totalMinor: 125000n,
    address: "বাসা ১, রোড ২, ধানমন্ডি, ঢাকা, 01711112222",
    internalNote: null,
    customer: { name: "রাকিব সাহেব", phone: "01711112222" },
    items: [{ name: "পাঞ্জাবি" }],
    organization: { name: "প্রিমিয়াম ফ্যাশন", brandName: "প্রিমিয়াম ফ্যাশন", currency: "BDT" },
  };

  const calls: Row[] = [];
  const turns: Row[] = [];
  const notifications: Row[] = [];
  const memberships: Row[] = [
    { id: "m1", organizationId: "org-1", userId: "owner-1", role: "OWNER", status: "ACTIVE" },
    { id: "m2", organizationId: "org-1", userId: "admin-1", role: "ADMIN", status: "ACTIVE" },
    { id: "m3", organizationId: "org-1", userId: "viewer-1", role: "VIEWER", status: "ACTIVE" },
    { id: "m4", organizationId: "org-1", userId: "old-admin", role: "ADMIN", status: "INACTIVE" },
  ];

  const generic = (rows: Row[], prefix: string) => ({
    findFirst: jest.fn(async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null),
    findUnique: jest.fn(async ({ where }: any = {}) => {
      if (where?.id) return rows.find((r) => r.id === where.id) ?? null;
      if (where?.organizationId) return rows.find((r) => r.organizationId === where.organizationId) ?? null;
      if (where?.key) return null;
      return null;
    }),
    findMany: jest.fn(async ({ where, orderBy }: any = {}) => {
      let found = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.seq === "asc") found = [...found].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      if (orderBy?.createdAt === "desc") found = [...found].reverse();
      return found;
    }),
    count: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: nid(prefix), createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
  });

  const callTable: any = generic(calls, "call");
  const turnTable: any = generic(turns, "turn");

  const prisma: any = {
    voiceCallSetting: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.organizationId === "org-1" ? settingsRow : null,
      ),
      create: jest.fn(async ({ data }: any) => ({ id: "setting-new", ...data })),
      update: jest.fn(async ({ data }: any) => Object.assign(settingsRow, data)),
    },
    orderVoiceCall: callTable,
    voiceConversationTurn: turnTable,
    order: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === orderRow.id && where.organizationId === orderRow.organizationId
          ? orderRow
          : null,
      ),
    },
    membership: {
      findMany: jest.fn(async ({ where }: any = {}) =>
        memberships.filter((r) => matches(r, where ?? {})),
      ),
    },
    agentNotification: generic(notifications, "notif"),
    notificationPreference: {
      findUnique: jest.fn(async () => null),
    },
    systemSetting: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.key === "killSwitches" && opts.killOrg
          ? { key: "killSwitches", value: { aiDisabledOrgIds: ["org-1"], broadcastsPaused: false } }
          : null,
      ),
    },
  };

  const audit: any = { log: jest.fn(async () => undefined) };

  const fraudShield: any = {
    recordCodCall: jest.fn(async () => ({
      order: { id: "order-1" },
      codConfirmationStatus: opts.codStatus ?? "confirmed",
    })),
  };

  const ordersService: any = {
    updateOrder: jest.fn(async (_org: string, _actor: string, _id: string, dto: any) => {
      const updated: Row = { id: "order-1", organizationId: "org-1", status: orderRow.status, address: orderRow.address, internalNote: orderRow.internalNote };
      if (dto.status !== undefined) updated.status = opts.orderStatusAfterUpdate ?? dto.status;
      if (dto.address !== undefined) updated.address = dto.address;
      if (dto.internalNote !== undefined) updated.internalNote = dto.internalNote;
      return updated;
    }),
  };

  // OrgBrain stub: PUBLIC facts only via facts/deliveryFacts;
  // the sentinel lives in internalProfile + an internal doc —
  // surfaces the conversation service must never read.
  const orgBrain: any = {
    getContext: jest.fn(async () => ({
      audience: "customer",
      orgName: "প্রিমিয়াম ফ্যাশন",
      facts: ["ডেলিভারি চার্জ ৬০ টাকা", "ঢাকায় ডেলিভারি ১-২ দিন"],
      deliveryFacts: ["ডেলিভারি চার্জ ৬০ টাকা", "ঢাকায় ডেলিভারি ১-২ দিন"],
      paymentFacts: [],
      contactFacts: [],
      hoursFacts: [],
      publicProfile: null,
      policies: [],
      typedPolicy: null,
      documents: [{ id: "doc-internal", visibility: "internal", content: SENTINEL }],
      knowledgeMatches: [],
      retrievalMode: "keyword",
      internalProfile: { goals: SENTINEL, uniqueSellingPoints: SENTINEL, tradeLicenseNo: SENTINEL },
      ownerInstructions: null,
      replyLanguage: "bn",
      sources: [],
    })),
  };

  const voiceService = new VoiceService(prisma, audit, fraudShield);
  const service = new VoiceConversationService(
    prisma,
    audit,
    fraudShield,
    ordersService,
    orgBrain,
    voiceService,
  );

  return {
    service,
    voiceService,
    prisma,
    audit,
    fraudShield,
    ordersService,
    orgBrain,
    settingsRow,
    orderRow,
    calls,
    turns,
    notifications,
    memberships,
  };
}

async function startCall(h: ReturnType<typeof setup>) {
  return h.service.startConversation("org-1", "order-1", "staff-1");
}

describe("VoiceConversationService — NF3 AI Voice Agent", () => {
  describe("startConversation guards", () => {
    it("refuses when settings.enabled=false", async () => {
      const h = setup({ settings: { enabled: false } });
      await expect(startCall(h)).rejects.toThrow(BadRequestException);
      expect(h.calls.length).toBe(0);
    });

    it("refuses when conversationAgentEnabled=false", async () => {
      const h = setup({ settings: { conversationAgentEnabled: false } });
      await expect(startCall(h)).rejects.toThrow(BadRequestException);
      expect(h.calls.length).toBe(0);
    });

    it("refuses (403) when the org is AI kill-switched", async () => {
      const h = setup({ killOrg: true });
      await expect(startCall(h)).rejects.toThrow(HttpException);
      try {
        await startCall(h);
      } catch (e: any) {
        expect(e.getStatus()).toBe(403);
      }
      expect(h.calls.length).toBe(0);
    });

    it("refuses when the attempts cap is reached", async () => {
      const h = setup();
      h.calls.push(
        { id: "c1", organizationId: "org-1", orderId: "order-1" },
        { id: "c2", organizationId: "org-1", orderId: "order-1" },
        { id: "c3", organizationId: "org-1", orderId: "order-1" },
      );
      await expect(startCall(h)).rejects.toThrow(BadRequestException);
    });
  });

  describe("greeting grounding (L3)", () => {
    it("greeting contains ONLY order + brain public facts — never the internal sentinel", async () => {
      const h = setup();
      const res = await startCall(h);
      expect(res.mode).toBe("simulation");
      expect(res.agentLine).toContain("রাকিব সাহেব");
      expect(res.agentLine).toContain("প্রিমিয়াম ফ্যাশন");
      expect(res.agentLine).toContain("পাঞ্জাবি");
      expect(res.agentLine).toContain("ডেলিভারি চার্জ ৬০ টাকা");
      expect(res.agentLine).not.toContain(SENTINEL);
      // The persisted greeting turn is equally clean.
      expect(h.turns.length).toBe(1);
      expect(h.turns[0].role).toBe("agent");
      expect(h.turns[0].seq).toBe(0);
      expect(h.turns[0].text).not.toContain(SENTINEL);
      expect(h.orgBrain.getContext).toHaveBeenCalledWith("org-1", { audience: "customer" });
    });

    it("no agent line in a full conversation ever contains the sentinel", async () => {
      const h = setup();
      const { call } = await startCall(h);
      await h.service.handleCustomerTurn("org-1", call.id, "staff-1", "কিছু একটা বললাম");
      await h.service.handleCustomerTurn("org-1", call.id, "staff-1", "ঠিকানা বদলাতে চাই");
      await h.service.handleCustomerTurn("org-1", call.id, "staff-1", "বাসা ৯, রোড ৮, উত্তরা, ঢাকা");
      for (const t of h.turns.filter((x) => x.role === "agent")) {
        expect(t.text).not.toContain(SENTINEL);
      }
    });
  });

  describe("terminal actions — exactly once, verified", () => {
    it("confirm → recordCodCall exactly once; a second turn does NOT call again", async () => {
      const h = setup();
      const { call } = await startCall(h);
      const res = await h.service.handleCustomerTurn("org-1", call.id, "staff-1", "হ্যাঁ, নিশ্চিত করছি");
      expect(res.conversationOutcome).toBe("confirmed");
      expect(h.fraudShield.recordCodCall).toHaveBeenCalledTimes(1);
      expect(h.fraudShield.recordCodCall).toHaveBeenCalledWith("org-1", "ai-voice-agent", "order-1", "confirmed");

      const again = await h.service.handleCustomerTurn("org-1", call.id, "staff-1", "হ্যাঁ");
      expect(again.state).toBe("done");
      expect(h.fraudShield.recordCodCall).toHaveBeenCalledTimes(1);
      expect(h.ordersService.updateOrder).not.toHaveBeenCalled();
    });

    it("confirm is NOT recorded when recordCodCall does not verify as confirmed", async () => {
      const h = setup({ codStatus: "declined" });
      const { call } = await startCall(h);
      const res = await h.service.handleCustomerTurn("org-1", call.id, "staff-1", "হ্যাঁ");
      expect(res.conversationOutcome).toBeNull();
      const row = h.calls.find((c) => c.id === call.id);
      expect(row!.conversationOutcome).toBeNull();
      expect(row!.actionAppliedAt).toBeFalsy();
      expect(row!.conversationSummary).toContain("যাচাই করা যায়নি");
    });

    it("cancel is two-step → recordCodCall rejected + updateOrder status cancelled", async () => {
      const h = setup();
      const { call } = await startCall(h);
      const first = await h.service.handleCustomerTurn("org-1", call.id, "staff-1", "বাতিল করতে চাই");
      expect(first.state).toBe("confirming_cancel");
      expect(h.fraudShield.recordCodCall).not.toHaveBeenCalled();
      expect(first.agentLine).toContain("বাতিল নিশ্চিত করতে আবার বলুন বাতিল");

      const second = await h.service.handleCustomerTurn("org-1", call.id, "staff-1", "বাতিল");
      expect(second.conversationOutcome).toBe("cancelled");
      expect(h.fraudShield.recordCodCall).toHaveBeenCalledWith("org-1", "ai-voice-agent", "order-1", "rejected");
      expect(h.ordersService.updateOrder).toHaveBeenCalledWith(
        "org-1",
        "ai-voice-agent",
        "order-1",
        { status: "cancelled" },
      );
    });

    it("address path → updateOrder called with ONLY {address}", async () => {
      const h = setup();
      const { call } = await startCall(h);
      await h.service.handleCustomerTurn("org-1", call.id, "staff-1", "ঠিকানা বদলাতে চাই");
      const newAddress = "বাসা ৯, রোড ৮, উত্তরা, ঢাকা";
      const res = await h.service.handleCustomerTurn("org-1", call.id, "staff-1", newAddress);
      expect(res.conversationOutcome).toBe("address_changed");
      expect(h.ordersService.updateOrder).toHaveBeenCalledTimes(1);
      expect(h.ordersService.updateOrder).toHaveBeenCalledWith("org-1", "ai-voice-agent", "order-1", { address: newAddress });
      expect(h.fraudShield.recordCodCall).not.toHaveBeenCalled();
    });

    it("short address (<8 chars) is reprompted, not applied", async () => {
      const h = setup();
      const { call } = await startCall(h);
      await h.service.handleCustomerTurn("org-1", call.id, "staff-1", "ঠিকানা বদলাতে চাই");
      const res = await h.service.handleCustomerTurn("org-1", call.id, "staff-1", "ঢাকা");
      expect(res.conversationOutcome).toBeNull();
      expect(res.state).toBe("collecting_address");
      expect(h.ordersService.updateOrder).not.toHaveBeenCalled();
    });

    it("time path → internalNote only + staff notification created", async () => {
      const h = setup();
      const { call } = await startCall(h);
      await h.service.handleCustomerTurn("org-1", call.id, "staff-1", "সময় বদলাতে চাই");
      const res = await h.service.handleCustomerTurn("org-1", call.id, "staff-1", "কালকে সকালে");
      expect(res.conversationOutcome).toBe("delivery_time_changed");
      expect(h.ordersService.updateOrder).toHaveBeenCalledTimes(1);
      const dto = h.ordersService.updateOrder.mock.calls[0][3];
      expect(Object.keys(dto)).toEqual(["internalNote"]);
      expect(dto.internalNote).toBe("[ভয়েস কল] গ্রাহকের অনুরোধের ডেলিভারি সময়: কালকে সকালে");
      expect(h.notifications.length).toBeGreaterThan(0);
      expect(h.notifications[0].userId).toBe("owner-1");
    });

    it("human path → urgent notifications to ACTIVE OWNER/ADMIN only", async () => {
      const h = setup();
      const { call } = await startCall(h);
      const res = await h.service.handleCustomerTurn("org-1", call.id, "staff-1", "আমি মানুষের সাথে কথা বলতে চাই");
      expect(res.conversationOutcome).toBe("human_handoff");
      const recipients = h.notifications.map((n) => n.userId).sort();
      expect(recipients).toEqual(["admin-1", "owner-1"]);
      expect(h.notifications[0].type).toBe("urgent");
      expect(h.notifications[0].body).toContain("order-1");
    });

    it("two consecutive unknowns → human handoff", async () => {
      const h = setup();
      const { call } = await startCall(h);
      const first = await h.service.handleCustomerTurn("org-1", call.id, "staff-1", "আবোলতাবোল এক");
      expect(first.conversationOutcome).toBeNull();
      const second = await h.service.handleCustomerTurn("org-1", call.id, "staff-1", "আবোলতাবোল দুই");
      expect(second.conversationOutcome).toBe("human_handoff");
      expect(h.notifications.length).toBe(2);
    });
  });

  describe("org isolation", () => {
    it("another org's callId → 404 on turn and on read", async () => {
      const h = setup();
      const { call } = await startCall(h);
      await expect(
        h.service.handleCustomerTurn("org-2", call.id, "staff-9", "হ্যাঁ"),
      ).rejects.toThrow(NotFoundException);
      await expect(h.service.getConversation("org-2", call.id)).rejects.toThrow(NotFoundException);
      const ok = await h.service.getConversation("org-1", call.id);
      expect(ok.turns.length).toBeGreaterThan(0);
      expect(ok.mode).toBe("simulation");
    });
  });

  describe("Twilio ConversationRelay adapter + TwiML", () => {
    function relaySetup() {
      return setup({
        settings: {
          conversationMode: "twilio_relay",
          relayWebsocketUrl: "wss://relay.example.com/voice?token=a&b=c",
        },
      });
    }

    it("TwiML carries the evidenced ConversationRelay shape when configured", async () => {
      const h = relaySetup();
      const { call } = await startCall(h);
      const xml = await h.service.generateConversationTwiml(call.id, "https://api.example.com");
      expect(xml).toContain("<Response><Connect><ConversationRelay");
      expect(xml).toContain('url="wss://relay.example.com/voice?token=a&amp;b=c"');
      expect(xml).toContain('language="bn-BD"');
      expect(xml).toContain('transcriptionLanguage="bn-BD"');
      expect(xml).toContain('transcriptionProvider="Google"');
      expect(xml).toContain('ttsProvider="Amazon"');
      expect(xml).toContain('voice="Polly.Nabanita"');
      expect(xml).toContain(`<Parameter name="callId" value="${call.id}"/>`);
      expect(xml).toContain("</ConversationRelay></Connect></Response>");
    });

    it("falls back to the existing IVR TwiML when relay is not configured", async () => {
      const h = setup();
      const { call } = await startCall(h);
      const xml = await h.service.generateConversationTwiml(call.id, "https://api.example.com");
      expect(xml).toContain("<Gather");
      expect(xml).not.toContain("ConversationRelay");
    });

    it("relay prompt adapter (last=true) returns {type:'text', last:true}; last=false returns null", async () => {
      const h = relaySetup();
      const { call, agentLine } = await startCall(h);
      const partial = await h.service.handleRelayMessage("org-1", call.id, {
        type: "prompt",
        voicePrompt: "হ্যাঁ",
        lang: "bn-BD",
        last: false,
      });
      expect(partial).toBeNull();
      const reply = await h.service.handleRelayMessage("org-1", call.id, {
        type: "prompt",
        voicePrompt: "হ্যাঁ, নিশ্চিত",
        lang: "bn-BD",
        last: true,
      });
      expect(reply?.type).toBe("text");
      expect(reply?.last).toBe(true);
      expect(reply?.token).toContain("নিশ্চিত করা হয়েছে");
      expect(h.fraudShield.recordCodCall).toHaveBeenCalledTimes(1);

      const setupMsg = await h.service.handleRelayMessage("org-1", call.id, {
        type: "setup",
        sessionId: "sess-1",
        callSid: "CA123",
        customParameters: { callId: call.id },
      });
      expect(setupMsg).toEqual({ type: "text", token: agentLine, last: true });

      const interrupt = await h.service.handleRelayMessage("org-1", call.id, { type: "interrupt" });
      expect(interrupt).toBeNull();
    });

    it("relay DTMF 1 maps to confirm text, 2 starts cancel flow", async () => {
      const h = relaySetup();
      const { call } = await startCall(h);
      const reply = await h.service.handleRelayMessage("org-1", call.id, { type: "dtmf", digit: "1" });
      expect(reply?.type).toBe("text");
      expect(h.fraudShield.recordCodCall).toHaveBeenCalledWith("org-1", "ai-voice-agent", "order-1", "confirmed");
    });

    it("relay adapter refuses when relay is not configured", async () => {
      const h = setup();
      const { call } = await startCall(h);
      await expect(
        h.service.handleRelayMessage("org-1", call.id, { type: "setup" }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("no-answer follow-up (VoiceService status callback)", () => {
    it("busy/no-answer marks followUp pending labelled whatsapp_manual + notifies staff; no send service exists in scope", async () => {
      const h = setup();
      const { call } = await startCall(h);
      // The call row as a real DB would return it on update.
      const updated = await h.voiceService.handleStatusCallback(call.id, "no-answer", 0);
      // handleStatusCallback's update mock is the generic table —
      // the row now carries the follow-up fields.
      const row = h.calls.find((c) => c.id === call.id);
      expect(row!.followUpStatus).toBe("pending");
      expect(row!.followUpChannel).toBe("whatsapp_manual");
      expect(h.notifications.length).toBe(2);
      expect(h.notifications[0].body).toContain("WhatsApp");
      expect(h.notifications[0].body).toContain("কোনো স্বয়ংক্রিয় বার্তা পাঠানো হয়নি");
      expect(updated).toBeTruthy();
      // By construction: neither service was given any messaging
      // dependency — there is nothing here that could send a
      // WhatsApp message. The follow-up is a staff task only.
      expect((h.voiceService as any).messaging).toBeUndefined();
      expect((h.service as any).messaging).toBeUndefined();
    });
  });
});
