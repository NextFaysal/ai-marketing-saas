import { describe, expect, it } from "vitest";
import {
  buildCourierConnectBody, buildEmailConnectBody, buildMessagingConnectBody, buildShopifyConnectBody,
  buildWooConnectBody, buildSenderEmailBody, buildSenderSmsBody, buildLlmConfigBody, buildGatewayBody, buildPayoutBody,
  emailResultText, initialAppSource, telegramResultText, PATHAO_SANDBOX_BASE,
  feeBpsToPercentInput, feeMinorToTakaInput, parseFeePercentToBps, parseFeeTakaToMinor,
} from "./connect-forms";

/**
 * CC5/CC6/CC7 — the Connect Center panels must send the EXISTING
 * pages' request shapes to the EXISTING endpoints. These tests
 * pin those shapes so a panel refactor cannot silently drift
 * from what the integrations / orders / inbox pages send.
 */
describe("CC5 commerce connect bodies", () => {
  it("woo body omits a blank webhookSecret and keeps the keys verbatim", () => {
    expect(buildWooConnectBody({ storeId: "s1", consumerKey: "ck", consumerSecret: "cs", webhookSecret: "" }))
      .toEqual({ storeId: "s1", consumerKey: "ck", consumerSecret: "cs", webhookSecret: undefined });
    expect(buildWooConnectBody({ storeId: "s1", consumerKey: "ck", consumerSecret: "cs", webhookSecret: "wh" }).webhookSecret).toBe("wh");
  });

  it("shopify legacy vs client-credentials bodies match the integrations page", () => {
    const legacy = { storeId: "s1", accessToken: "shpat_x", apiSecret: "shpss_y" };
    const cc = { clientId: "cid", clientSecret: "csecret" };
    expect(buildShopifyConnectBody("legacy", legacy, cc)).toEqual({ storeId: "s1", accessToken: "shpat_x", apiSecret: "shpss_y" });
    expect(buildShopifyConnectBody("client-credentials", legacy, cc)).toEqual({ storeId: "s1", clientId: "cid", clientSecret: "csecret" });
  });
});

describe("CC6 courier connect bodies", () => {
  const forms = {
    steadfast: { apiKey: "ak", secretKey: "sk" },
    pathao: { clientId: "cid", clientSecret: "cs", username: "m@shop.com", password: "pw", sandbox: false },
    redx: { accessToken: "tok", baseUrl: "" },
  };
  it("steadfast names the provider and sends key + secret", () => {
    expect(buildCourierConnectBody("steadfast", forms)).toEqual({ provider: "steadfast", apiKey: "ak", secretKey: "sk" });
  });
  it("pathao sandbox maps to the sandbox base URL; production omits baseUrl", () => {
    expect(buildCourierConnectBody("pathao", forms).baseUrl).toBeUndefined();
    const sandbox = buildCourierConnectBody("pathao", { ...forms, pathao: { ...forms.pathao, sandbox: true } });
    expect(sandbox.baseUrl).toBe(PATHAO_SANDBOX_BASE);
    expect(sandbox).toMatchObject({ provider: "pathao", clientId: "cid", username: "m@shop.com" });
  });
  it("redx omits a blank baseUrl and keeps a legacy one", () => {
    expect(buildCourierConnectBody("redx", forms)).toEqual({ provider: "redx", accessToken: "tok", baseUrl: undefined });
    expect(buildCourierConnectBody("redx", { ...forms, redx: { accessToken: "tok", baseUrl: "https://legacy.example" } }).baseUrl).toBe("https://legacy.example");
  });
});

describe("CC7 messaging connect bodies", () => {
  it("messaging body is the inbox form state verbatim, appSource included", () => {
    const form = { channel: "whatsapp", accessToken: "tok", appSecret: "", verifyToken: "vt", phoneNumberId: "123", pageId: "", appSource: "own" };
    expect(buildMessagingConnectBody(form)).toEqual(form);
  });
  it("email body is the inbox email form verbatim", () => {
    const form = { imapHost: "imap.x", imapPort: 993, smtpHost: "smtp.x", smtpPort: 587, user: "a@b.com", password: "pw" };
    expect(buildEmailConnectBody(form)).toEqual(form);
  });
  it("initialAppSource honours ?appSource=own and defaults to platform", () => {
    expect(initialAppSource("?appSource=own")).toBe("own");
    expect(initialAppSource("?appSource=platform")).toBe("platform");
    expect(initialAppSource("")).toBe("platform");
  });
  it("result texts report webhook reality and reconnect truthfully", () => {
    expect(telegramResultText({ bot: "@shop_bot", webhook: { registered: true } })).toContain("নিবন্ধিত ✅");
    expect(telegramResultText({ bot: "@shop_bot", webhook: { registered: false, error: "no public url" } })).toContain("হয়নি — no public url");
    expect(telegramResultText({ bot: "@shop_bot", webhook: { registered: true }, reconnected: true })).toContain("আবার কানেক্ট হয়েছে");
    expect(emailResultText({ mailbox: "a@b.com" })).toBe("কানেক্ট হয়েছে: a@b.com");
    expect(emailResultText({ mailbox: "a@b.com", reconnected: true })).toContain("আবার কানেক্ট হয়েছে");
  });
});

describe("CC8 sender + LLM bodies", () => {
  it("sender email body matches the messaging page shape (port numeric, blanks omitted)", () => {
    const body = buildSenderEmailBody({ smtpHost: "mail.x.com", smtpPort: "587", smtpUser: "u", smtpPass: "", fromAddress: "a@x.com", fromName: "", dkimSelector: "" });
    expect(body).toEqual({ smtpHost: "mail.x.com", smtpPort: 587, smtpUser: "u", smtpPass: undefined, fromAddress: "a@x.com", fromName: undefined, dkimSelector: undefined });
  });

  it("sender sms body omits a blank api key and api url", () => {
    const body = buildSenderSmsBody({ smsGateway: "alphasms", smsApiKey: "", smsSenderId: "BRAND", smsApiUrl: "" });
    expect(body).toEqual({ smsGateway: "alphasms", smsApiKey: undefined, smsSenderId: "BRAND", smsApiUrl: undefined });
  });

  it("llm config body omits a blank model", () => {
    expect(buildLlmConfigBody({ provider: "gemini", apiKey: "k", model: "  " })).toEqual({ provider: "gemini", apiKey: "k", model: undefined });
    expect(buildLlmConfigBody({ provider: "openai", apiKey: "k", model: "gpt-x" }).model).toBe("gpt-x");
  });
});

describe("CC10 payout bodies", () => {
  it("bkash payout sends minor units + only the bkash destination", () => {
    expect(buildPayoutBody({
      amountTaka: "5000", method: "bkash", bkashNumber: " 01700000000 ",
      accountName: "X", accountNumber: "Y", bankName: "Z", branch: "B",
    })).toEqual({ amountMinor: "500000", method: "bkash", destination: { number: "01700000000" } });
  });

  it("bank payout converts fractional taka and omits a blank branch", () => {
    expect(buildPayoutBody({
      amountTaka: "1250.50", method: "bank", bkashNumber: "017",
      accountName: "Shop", accountNumber: "123-456", bankName: "DBBL", branch: "  ",
    })).toEqual({
      amountMinor: "125050", method: "bank",
      destination: { accountName: "Shop", accountNumber: "123-456", bankName: "DBBL" },
    });
  });
});

describe("CC9 gateway bodies", () => {
  const form = {
    storeId: "store1", storePass: "sp", username: "017", password: "pw", appKey: "ak", appSecret: "as",
    merchantId: "M1", privateKey: "pk", prefix: "SPX", signatureKey: "sig-key", sandbox: true,
  };

  it("each provider sends ONLY its own field subset", () => {
    expect(buildGatewayBody("sslcommerz", form)).toEqual({ storeId: "store1", storePass: "sp", sandbox: true });
    expect(buildGatewayBody("bkash", form)).toEqual({ username: "017", password: "pw", appKey: "ak", appSecret: "as", sandbox: true });
    expect(buildGatewayBody("nagad", form)).toEqual({ merchantId: "M1", privateKey: "pk" });
    expect(buildGatewayBody("shurjopay", form)).toEqual({ username: "017", password: "pw", prefix: "SPX", storeId: "store1", sandbox: true });
    expect(buildGatewayBody("aamarpay", form)).toEqual({ storeId: "store1", signatureKey: "sig-key", sandbox: true });
  });

  it("shurjopay omits a blank optional store id", () => {
    expect(buildGatewayBody("shurjopay", { ...form, storeId: "  " }))
      .toEqual({ username: "017", password: "pw", prefix: "SPX", storeId: undefined, sandbox: true });
  });

  it("GC12: a form without fee fields sends NO fee keys (stored fees untouched by the API)", () => {
    const body: any = buildGatewayBody("sslcommerz", form);
    expect("feeBps" in body).toBe(false);
    expect("feeFixedMinor" in body).toBe(false);
  });
});

describe("GC12 gateway fee conversions + body round-trip", () => {
  const form = {
    storeId: "store1", storePass: "sp", username: "017", password: "pw", appKey: "ak", appSecret: "as",
    merchantId: "M1", privateKey: "pk", prefix: "SPX", signatureKey: "sig-key", sandbox: true,
  };

  it("bps ↔ percent and minor ↔ taka conversions round-trip", () => {
    expect(feeBpsToPercentInput(250)).toBe("2.5");
    expect(feeBpsToPercentInput(200)).toBe("2");
    expect(feeBpsToPercentInput(null)).toBe("");
    expect(parseFeePercentToBps("2.5")).toEqual({ ok: true, bps: 250 });
    expect(parseFeePercentToBps("")).toEqual({ ok: true, bps: null });
    expect(parseFeePercentToBps("101")).toEqual({ ok: false });
    expect(parseFeePercentToBps("-1")).toEqual({ ok: false });
    expect(feeMinorToTakaInput("150")).toBe("1.5");
    expect(feeMinorToTakaInput("155")).toBe("1.55");
    expect(feeMinorToTakaInput("100")).toBe("1");
    expect(feeMinorToTakaInput(null)).toBe("");
    expect(parseFeeTakaToMinor("1.5")).toEqual({ ok: true, minor: "150" });
    expect(parseFeeTakaToMinor("1.55")).toEqual({ ok: true, minor: "155" });
    expect(parseFeeTakaToMinor("")).toEqual({ ok: true, minor: null });
    expect(parseFeeTakaToMinor("1.234")).toEqual({ ok: false });
    // full round-trip: stored values → inputs → body values
    const pct = feeBpsToPercentInput(275);
    const taka = feeMinorToTakaInput("275");
    expect(parseFeePercentToBps(pct)).toEqual({ ok: true, bps: 275 });
    expect(parseFeeTakaToMinor(taka)).toEqual({ ok: true, minor: "275" });
  });

  it("the panel flow always sends the displayed fee values; cleared inputs send explicit null", () => {
    expect(buildGatewayBody("sslcommerz", { ...form, feePercent: "2.5", feeFixedTaka: "1.50" }))
      .toEqual({ storeId: "store1", storePass: "sp", sandbox: true, feeBps: 250, feeFixedMinor: "150" });
    // merchant cleared both inputs (they previously held values) → explicit nulls clear the columns
    expect(buildGatewayBody("sslcommerz", { ...form, feePercent: "", feeFixedTaka: "" }))
      .toEqual({ storeId: "store1", storePass: "sp", sandbox: true, feeBps: null, feeFixedMinor: null });
    // untouched re-save: prefilled inputs re-send the SAME stored values — nothing is wiped
    expect(buildGatewayBody("bkash", { ...form, feePercent: feeBpsToPercentInput(150), feeFixedTaka: feeMinorToTakaInput("30") }))
      .toEqual({ username: "017", password: "pw", appKey: "ak", appSecret: "as", sandbox: true, feeBps: 150, feeFixedMinor: "30" });
  });
});
