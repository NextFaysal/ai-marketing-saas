import { describe, expect, it } from "vitest";
import {
  DELIVERY_ATTEMPT_OUTCOMES, NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS, TEMPLATE_VARIABLES, TEMPLATE_VARIABLE_HELP,
  deliveryAttemptOutcomeLabel, formatAge, notificationChannelLabel, notificationEventLabel, notificationStatusLabel, slaStageLabel,
  DEFAULT_TEMPLATES, calculateSmsSegments, renderNotificationTemplate, generateWhatsAppTrackingShareUrl,
} from "./orders-on5";

describe("NOTIFICATION_EVENTS / event labels", () => {
  it("carries exactly the eight fixed API event keys in order", () => {
    expect([...NOTIFICATION_EVENTS]).toEqual([
      "order_placed", "order_packed", "handed_to_courier", "out_for_delivery",
      "delivered", "delivery_failed", "parcel_stuck", "delivery_rescheduled",
    ]);
  });
  it("labels every event in Bengali", () => {
    for (const e of NOTIFICATION_EVENTS) {
      expect(notificationEventLabel(e)).not.toBe(e);
      expect(notificationEventLabel(e)).not.toBe("—");
    }
    expect(notificationEventLabel("order_placed")).toBe("অর্ডার গৃহীত");
    expect(notificationEventLabel("delivered")).toBe("ডেলিভারি সম্পন্ন");
    expect(notificationEventLabel("delivery_rescheduled")).toBe("ডেলিভারি পুনঃনির্ধারিত");
  });
  it("missing event renders as a dash, unknown passes through", () => {
    expect(notificationEventLabel(null)).toBe("—");
    expect(notificationEventLabel(undefined)).toBe("—");
    expect(notificationEventLabel("something_else")).toBe("something_else");
  });
});

describe("NOTIFICATION_CHANNELS / channel labels", () => {
  it("keeps the canonical try-order sms → whatsapp → email", () => {
    expect([...NOTIFICATION_CHANNELS]).toEqual(["sms", "whatsapp", "email"]);
  });
  it("labels channels (incl. the log pseudo-channels)", () => {
    expect(notificationChannelLabel("sms")).toBe("SMS");
    expect(notificationChannelLabel("whatsapp")).toBe("WhatsApp");
    expect(notificationChannelLabel("email")).toBe("ইমেইল");
    expect(notificationChannelLabel("none")).toBe("কোনো চ্যানেল নয়");
    expect(notificationChannelLabel("legacy")).toBe("আগের সিস্টেম");
    expect(notificationChannelLabel(null)).toBe("—");
  });
});

describe("notificationStatusLabel", () => {
  it("labels every log status the ON5 service writes", () => {
    expect(notificationStatusLabel("sent")).toBe("পাঠানো হয়েছে");
    expect(notificationStatusLabel("failed_no_channel")).toBe("চ্যানেল নেই");
    expect(notificationStatusLabel("failed_error")).toBe("ব্যর্থ");
    expect(notificationStatusLabel("skipped_setting_off")).toBe("বন্ধ ছিল");
    expect(notificationStatusLabel("covered_existing")).toBe("আগের বার্তায় হয়েছে");
  });
  it("missing status renders as a dash, unknown passes through", () => {
    expect(notificationStatusLabel(null)).toBe("—");
    expect(notificationStatusLabel("queued")).toBe("queued");
  });
});

describe("TEMPLATE_VARIABLES / help", () => {
  it("carries exactly the nine allowed variables", () => {
    expect([...TEMPLATE_VARIABLES]).toEqual([
      "customerName", "orderNumber", "total", "due", "trackingUrl",
      "shopName", "courierName", "trackingCode", "rescheduleDate",
    ]);
  });
  it("help line renders each variable in {{token}} form", () => {
    for (const v of TEMPLATE_VARIABLES) expect(TEMPLATE_VARIABLE_HELP).toContain(`{{${v}}}`);
  });
});

describe("DELIVERY_ATTEMPT_OUTCOMES / label", () => {
  it("carries exactly the five fixed API outcome keys", () => {
    expect(DELIVERY_ATTEMPT_OUTCOMES.map((o) => o.key)).toEqual([
      "customer_unavailable", "refused", "address_issue", "rescheduled", "other",
    ]);
  });
  it("labels outcomes in Bengali; missing = dash, unknown passes through", () => {
    expect(deliveryAttemptOutcomeLabel("customer_unavailable")).toBe("গ্রাহক পাওয়া যায়নি");
    expect(deliveryAttemptOutcomeLabel("rescheduled")).toBe("পুনঃনির্ধারিত");
    expect(deliveryAttemptOutcomeLabel(null)).toBe("—");
    expect(deliveryAttemptOutcomeLabel("weird")).toBe("weird");
  });
});

describe("slaStageLabel", () => {
  it("labels the four sla.ts stages", () => {
    expect(slaStageLabel("awaiting_pack")).toBe("প্যাক বাকি");
    expect(slaStageLabel("awaiting_handover")).toBe("হস্তান্তর বাকি");
    expect(slaStageLabel("shipped")).toBe("পাঠানো হয়েছে");
    expect(slaStageLabel("not_applicable")).toBe("প্রযোজ্য নয়");
    expect(slaStageLabel(null)).toBe("—");
  });
});

describe("formatAge", () => {
  it("formats hours and days", () => {
    expect(formatAge(0)).toBe("১ ঘণ্টার কম");
    expect(formatAge(0.5)).toBe("১ ঘণ্টার কম");
    expect(formatAge(5)).toBe("5 ঘণ্টা");
    expect(formatAge(23.9)).toBe("23 ঘণ্টা");
    expect(formatAge(24)).toBe("1 দিন");
    expect(formatAge(51)).toBe("2 দিন 3 ঘণ্টা");
  });
  it("null / invalid renders as a dash, never a fabricated age", () => {
    expect(formatAge(null)).toBe("—");
    expect(formatAge(undefined)).toBe("—");
    expect(formatAge(Number.NaN)).toBe("—");
    expect(formatAge(-3)).toBe("—");
  });
});

describe("DEFAULT_TEMPLATES", () => {
  it("provides templates for all 8 notification events", () => {
    for (const ev of NOTIFICATION_EVENTS) {
      expect(DEFAULT_TEMPLATES[ev]).toBeTruthy();
      expect(DEFAULT_TEMPLATES[ev]).toContain("আসসালামু আলাইকুম");
    }
  });
});

describe("renderNotificationTemplate", () => {
  it("substitutes double and single brace tokens accurately", () => {
    const tpl = "হ্যালো {{customerName}}, আপনার অর্ডার {{orderNumber}} এর মোট টাকা {total}।";
    const rendered = renderNotificationTemplate(tpl, {
      customerName: "শাকিব খান",
      orderNumber: "ORD-101",
      total: "৳1,500",
    });
    expect(rendered).toBe("হ্যালো শাকিব খান, আপনার অর্ডার ORD-101 এর মোট টাকা ৳1,500।");
  });

  it("handles missing variables without throwing or printing undefined", () => {
    const tpl = "হ্যালো {{customerName}}, ট্র্যাকিং: {{trackingUrl}}";
    const rendered = renderNotificationTemplate(tpl, {
      customerName: "রাকিব",
    });
    expect(rendered).toBe("হ্যালো রাকিব, ট্র্যাকিং: ");
  });
});

describe("calculateSmsSegments", () => {
  it("calculates English ASCII GSM-7 segments", () => {
    const single = calculateSmsSegments("Hello, your order is confirmed!");
    expect(single.isUnicode).toBe(false);
    expect(single.segments).toBe(1);
    expect(single.maxPerSegment).toBe(160);

    const longAscii = "A".repeat(161);
    const multi = calculateSmsSegments(longAscii);
    expect(multi.isUnicode).toBe(false);
    expect(multi.segments).toBe(2);
  });

  it("calculates Bengali Unicode segments (70 single, 67 multi)", () => {
    const singleBn = calculateSmsSegments("আপনার অর্ডার গ্রহণ করা হয়েছে।");
    expect(singleBn.isUnicode).toBe(true);
    expect(singleBn.segments).toBe(1);
    expect(singleBn.maxPerSegment).toBe(70);

    const longBn = "বাংলা ".repeat(20); // ~120 chars
    const multiBn = calculateSmsSegments(longBn);
    expect(multiBn.isUnicode).toBe(true);
    expect(multiBn.segments).toBe(Math.ceil(longBn.length / 67));
  });
});

describe("generateWhatsAppTrackingShareUrl", () => {
  it("formats Bangladeshi phone numbers and encodes message", () => {
    const url = generateWhatsAppTrackingShareUrl("01712345678", "আপনার ট্র্যাকিং লিঙ্ক: https://shop.com/track/123");
    expect(url).toContain("https://wa.me/8801712345678?text=");
    expect(decodeURIComponent(url)).toContain("আপনার ট্র্যাকিং লিঙ্ক: https://shop.com/track/123");
  });
});

