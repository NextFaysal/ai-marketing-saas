import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger } from "@nestjs/common";
import { AppModule } from "./app.module";
import { v1AliasMiddleware } from "./public-docs/v1-alias";

async function bootstrap() {
  // rawBody is required to verify WooCommerce webhook HMAC signatures.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // Milestone 59: the white-label logo upload travels as base64 JSON
  // (<=1.5 MB of image bytes, ~2 MB encoded) — the 100 kb framework
  // default would reject it. 3 MB keeps the ceiling tight.
  (app as any).useBodyParser("json", { limit: "3mb" });
  // GC23: the /v1 alias for the documented public API — rewrites
  // ONLY /v1/public/shop/*, /v1/public/landing/* and /v1/tracking/*
  // to their canonical unversioned routes before Nest routing.
  app.use(v1AliasMiddleware);
  app.enableCors({ origin: process.env.WEB_URL ?? "http://localhost:3000", credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}`, "Bootstrap");
  // Dynamic platform config (Milestone 33): load the Admin Console
  // settings into the process snapshot so LLM/email/SMS/Meta read
  // them from the first request. Failure = env fallbacks apply.
  try {
    const { PrismaService } = await import("./prisma/prisma.service");
    const { refreshPlatformConfig } = await import("./common/platform-config");
    await refreshPlatformConfig(app.get(PrismaService) as any);
    Logger.log("Platform config snapshot loaded", "Bootstrap");
  } catch (e) {
    Logger.warn(`Platform config snapshot not loaded (${e instanceof Error ? e.message : "unknown"}); env fallbacks apply`, "Bootstrap");
  }
}
bootstrap();
