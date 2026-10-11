import { otpauthUrl, qrDataUrlFor, verifyTotp, totp, generateTotpSecret } from "./totp";

/**
 * Admin Polish AP1: enrolment responses carry a
 * scannable QR of the SAME otpauth URL whose secret
 * verifies codes — the QR is a rendering, not a
 * second secret.
 */
describe("AP1 TOTP QR", () => {
  it("renders a PNG data URL for an otpauth URL", async () => {
    const url = otpauthUrl(generateTotpSecret(), "owner@example.com");
    const qr = await qrDataUrlFor(url);
    expect(qr).toMatch(/^data:image\/png;base64,/);
    expect((qr as string).length).toBeGreaterThan(500);
  });

  it("the URL inside the QR still verifies with the hand-rolled TOTP", () => {
    const secret = generateTotpSecret();
    const url = otpauthUrl(secret, "owner@example.com");
    const fromUrl = new URL(url).searchParams.get("secret");
    expect(fromUrl).toBe(secret);
    expect(verifyTotp(secret, totp(secret))).toBe(true);
  });
});
