import { VoiceService } from "./voice.service";
import { buildBanglaVoicePrompt } from "./voice.types";

describe("VoiceService — Automated COD Confirmation Engine", () => {
  let service: VoiceService;
  let prismaMock: any;
  let auditMock: any;
  let fraudShieldMock: any;

  beforeEach(() => {
    prismaMock = {
      voiceCallSetting: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      orderVoiceCall: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      order: {
        findFirst: jest.fn(),
      },
    };

    auditMock = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    fraudShieldMock = {
      recordCodCall: jest.fn().mockResolvedValue({
        order: { id: "order-1", status: "processing" },
        codConfirmationStatus: "confirmed",
      }),
    };

    service = new VoiceService(prismaMock, auditMock, fraudShieldMock);
  });

  describe("Bangla Voice Prompt Builder", () => {
    it("generates a natural Bengali prompt with customer, brand, items and total", () => {
      const prompt = buildBanglaVoicePrompt({
        customerName: "রাকিব সাহেব",
        brandName: "প্রিমিয়াম ফ্যাশন",
        itemsSummary: "১ টি পাঞ্জাবি",
        totalFormatted: "১২৫০.০০",
      });

      expect(prompt).toContain("আসসালামু আলাইকুম।");
      expect(prompt).toContain("রাকিব সাহেব");
      expect(prompt).toContain("প্রিমিয়াম ফ্যাশন");
      expect(prompt).toContain("১ টি পাঞ্জাবি");
      expect(prompt).toContain("১২৫০.০০ টাকার");
      expect(prompt).toContain("নিশ্চিত করতে ১ চাপুন");
      expect(prompt).toContain("বাতিল করতে ২ চাপুন");
    });

    it("falls back gracefully when optional fields are missing", () => {
      const prompt = buildBanglaVoicePrompt({});
      expect(prompt).toContain("আসসালামু আলাইকুম।");
      expect(prompt).toContain("আমাদের শপ");
      expect(prompt).toContain("নিশ্চিত করতে ১ চাপুন");
      expect(prompt).toContain("বাতিল করতে ২ চাপুন");
    });
  });

  describe("Settings Management", () => {
    it("returns default settings if not exists", async () => {
      prismaMock.voiceCallSetting.findUnique.mockResolvedValue(null);
      prismaMock.voiceCallSetting.create.mockResolvedValue({
        id: "setting-1",
        organizationId: "org-1",
        enabled: false,
        provider: "mock",
      });

      const res = await service.getSettings("org-1");
      expect(res.provider).toBe("mock");
      expect(prismaMock.voiceCallSetting.create).toHaveBeenCalled();
    });

    it("updates voice call settings cleanly", async () => {
      prismaMock.voiceCallSetting.findUnique.mockResolvedValue({
        id: "setting-1",
        organizationId: "org-1",
        enabled: false,
      });
      prismaMock.voiceCallSetting.update.mockResolvedValue({
        id: "setting-1",
        organizationId: "org-1",
        enabled: true,
        provider: "twilio",
        twilioAccountSid: "AC123456",
      });

      const res = await service.updateSettings("org-1", "user-1", {
        enabled: true,
        provider: "twilio",
        twilioAccountSid: "AC123456",
      });

      expect(res.enabled).toBe(true);
      expect(res.provider).toBe("twilio");
      expect(auditMock.log).toHaveBeenCalled();
    });
  });

  describe("Initiate Call", () => {
    it("throws a coded not-found if order does not exist", async () => {
      prismaMock.order.findFirst.mockResolvedValue(null);

      await expect(
        service.initiateCall("org-1", "non-existent", "user-1"),
      ).rejects.toMatchObject({ code: "voice.orderNotFound" });
    });

    it("throws a coded bad-request if order is not COD", async () => {
      prismaMock.order.findFirst.mockResolvedValue({
        id: "order-1",
        isCod: false,
      });

      await expect(
        service.initiateCall("org-1", "order-1", "user-1"),
      ).rejects.toMatchObject({ code: "voice.notCodOrder" });
    });

    it("throws a coded bad-request if customer phone is missing", async () => {
      prismaMock.order.findFirst.mockResolvedValue({
        id: "order-1",
        isCod: true,
        customer: null,
        address: null,
      });

      await expect(
        service.initiateCall("org-1", "order-1", "user-1"),
      ).rejects.toMatchObject({ code: "voice.phoneMissing" });
    });

    it("creates an outbound call record and dispatches in mock mode", async () => {
      prismaMock.order.findFirst.mockResolvedValue({
        id: "order-1",
        isCod: true,
        totalMinor: 150000n,
        customer: { name: "জামাল উদ্দিন", phone: "01711112222" },
        items: [{ name: "লেদার ওয়ালেট" }],
        organization: { name: "স্মার্ট শপ", currency: "BDT" },
      });

      prismaMock.voiceCallSetting.findUnique.mockResolvedValue({
        id: "setting-1",
        provider: "mock",
        enabled: true,
      });

      prismaMock.orderVoiceCall.create.mockResolvedValue({
        id: "call-1",
        orderId: "order-1",
        phone: "01711112222",
        status: "initiated",
        provider: "mock",
        speechPrompt: "টেস্ট প্রম্পট",
      });

      prismaMock.orderVoiceCall.update.mockResolvedValue({
        id: "call-1",
        status: "in_progress",
      });

      const call = await service.initiateCall("org-1", "order-1", "user-1");

      expect(call.id).toBe("call-1");
      expect(prismaMock.orderVoiceCall.create).toHaveBeenCalled();
      expect(prismaMock.orderVoiceCall.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "call-1" },
          data: expect.objectContaining({ status: "in_progress" }),
        }),
      );
    });
  });

  describe("TwiML Generation", () => {
    it("generates valid TwiML XML with Gather and Bengali text-to-speech", async () => {
      prismaMock.orderVoiceCall.findUnique.mockResolvedValue({
        id: "call-1",
        speechPrompt: "অর্ডার কনফার্ম করতে ১ চাপুন",
      });

      const xml = await service.generateTwiml("call-1", "https://api.example.com");

      expect(xml).toContain("<?xml version=");
      expect(xml).toContain("<Gather");
      expect(xml).toContain('action="https://api.example.com/voice/webhook/gather/call-1"');
      expect(xml).toContain('<Say language="bn-BD" voice="Polly.Nabanita">');
      expect(xml).toContain("অর্ডার কনফার্ম করতে ১ চাপুন");
    });

    it("D-MB4-9: TwiML honours the configured conversationLanguage (en-US)", async () => {
      prismaMock.orderVoiceCall.findUnique.mockResolvedValue({
        id: "call-1",
        organizationId: "org-1",
        speechPrompt: "Press 1 to confirm your order",
      });
      prismaMock.voiceCallSetting.findUnique.mockResolvedValue({
        organizationId: "org-1",
        conversationLanguage: "en-US",
      });

      const xml = await service.generateTwiml("call-1", "https://api.example.com");

      expect(xml).toContain('<Say language="en-US">');
      expect(xml).not.toContain('language="bn-BD"');
      expect(xml).toContain("We did not receive a response. Thank you.");
    });

    it("D-MB4-9: gather-result TwiML honours conversationLanguage (en-US)", async () => {
      prismaMock.orderVoiceCall.findUnique.mockResolvedValue({
        id: "call-1",
        orderId: "order-1",
        organizationId: "org-1",
      });
      prismaMock.voiceCallSetting.findUnique.mockResolvedValue({
        organizationId: "org-1",
        conversationLanguage: "en-US",
      });
      prismaMock.orderVoiceCall.update.mockResolvedValue({
        id: "call-1",
        status: "completed",
        outcome: "confirmed",
        digitsPressed: "1",
      });

      const result = await service.handleGatherResult("call-1", "1");

      expect(result.outcome).toBe("confirmed");
      expect(result.xml).toContain('<Say language="en-US">');
      expect(result.xml).toContain("Your order has been confirmed");
    });
  });

  describe("DTMF Keypress / Gather Webhook", () => {
    it("confirms order when customer presses 1", async () => {
      prismaMock.orderVoiceCall.findUnique.mockResolvedValue({
        id: "call-1",
        orderId: "order-1",
        organizationId: "org-1",
      });

      prismaMock.orderVoiceCall.update.mockResolvedValue({
        id: "call-1",
        status: "completed",
        outcome: "confirmed",
        digitsPressed: "1",
      });

      const result = await service.handleGatherResult("call-1", "1");

      expect(result.outcome).toBe("confirmed");
      expect(result.xml).toContain("অর্ডারটি নিশ্চিত করা হয়েছে");
      expect(fraudShieldMock.recordCodCall).toHaveBeenCalledWith(
        "org-1",
        "ai-voice-bot",
        "order-1",
        "confirmed",
      );
    });

    it("rejects order when customer presses 2", async () => {
      prismaMock.orderVoiceCall.findUnique.mockResolvedValue({
        id: "call-1",
        orderId: "order-1",
        organizationId: "org-1",
      });

      prismaMock.orderVoiceCall.update.mockResolvedValue({
        id: "call-1",
        status: "completed",
        outcome: "rejected",
        digitsPressed: "2",
      });

      const result = await service.handleGatherResult("call-1", "2");

      expect(result.outcome).toBe("rejected");
      expect(result.xml).toContain("বাতিলের অনুরোধ গ্রহণ করা হয়েছে");
      expect(fraudShieldMock.recordCodCall).toHaveBeenCalledWith(
        "org-1",
        "ai-voice-bot",
        "order-1",
        "rejected",
      );
    });

    it("handles no digits or unreachable customer gracefully", async () => {
      prismaMock.orderVoiceCall.findUnique.mockResolvedValue({
        id: "call-1",
        orderId: "order-1",
        organizationId: "org-1",
      });

      prismaMock.orderVoiceCall.update.mockResolvedValue({
        id: "call-1",
        status: "completed",
        outcome: "unreachable",
        digitsPressed: null,
      });

      const result = await service.handleGatherResult("call-1", "");

      expect(result.outcome).toBe("unreachable");
      expect(fraudShieldMock.recordCodCall).toHaveBeenCalledWith(
        "org-1",
        "ai-voice-bot",
        "order-1",
        "unreachable",
      );
    });
  });

  describe("Status Callback & Simulation", () => {
    it("updates call status on Twilio callback", async () => {
      prismaMock.orderVoiceCall.update.mockResolvedValue({
        id: "call-1",
        status: "busy",
        outcome: "unreachable",
      });

      const updated = await service.handleStatusCallback("call-1", "busy", 0);
      expect(updated.status).toBe("busy");
      expect(prismaMock.orderVoiceCall.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "call-1" },
          data: expect.objectContaining({ status: "busy", outcome: "unreachable" }),
        }),
      );
    });

    it("simulates customer response directly in mock mode", async () => {
      prismaMock.orderVoiceCall.findUnique.mockResolvedValue({
        id: "call-1",
        orderId: "order-1",
        organizationId: "org-1",
      });

      prismaMock.orderVoiceCall.update.mockResolvedValue({
        id: "call-1",
        status: "completed",
        outcome: "confirmed",
        digitsPressed: "1",
      });

      const res = await service.simulateCustomerResponse("call-1", "1");
      expect(res.outcome).toBe("confirmed");
    });
  });
});
