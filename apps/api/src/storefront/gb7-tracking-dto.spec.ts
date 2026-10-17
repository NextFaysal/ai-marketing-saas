import { ArgumentMetadata, BadRequestException, ValidationPipe } from "@nestjs/common";
import { UpdateStorefrontSettingsDto } from "./storefront.dto";

/**
 * GB7 regression: the global ValidationPipe runs with
 * whitelist + forbidNonWhitelisted (see main.ts). The GB7
 * tracking ids were added to the Prisma model, the service
 * write path and the web form, but NOT to
 * UpdateStorefrontSettingsDto — so every settings save that
 * included a tracking id died at the pipe with
 * "property ga4MeasurementId should not exist" (owner-hit live
 * 2026-10-18 while enabling his first shop). Service-level
 * specs call updateSettings directly and never saw the pipe.
 * This spec exercises the DTO through the pipe itself.
 */
describe("GB7 tracking fields — UpdateStorefrontSettingsDto through the global pipe", () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const meta: ArgumentMetadata = { type: "body", metatype: UpdateStorefrontSettingsDto, data: undefined };

  it("admits a settings save carrying all eight tracking ids", async () => {
    const body = {
      shopEnabled: true,
      ga4MeasurementId: "G-ABC1234567",
      gtmContainerId: "GTM-ABC1234",
      googleAdsId: "AW-123456789",
      googleAdsConversionLabel: "AbC-dEf_123456",
      searchConsoleVerification: "abcdefghijklmnopqrstuvwxyz0123456789ABCD",
      metaPixelId: "123456789012345",
      tikTokPixelId: "C1234567890ABCDEF",
      clarityId: "abcdefgh12",
    };
    const out: any = await pipe.transform(body, meta);
    expect(out).toBeInstanceOf(UpdateStorefrontSettingsDto);
    for (const [k, v] of Object.entries(body)) expect(out[k]).toEqual(v);
  });

  it("still refuses a genuinely unknown property", async () => {
    await expect(pipe.transform({ notARealField: "x" }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });
});
