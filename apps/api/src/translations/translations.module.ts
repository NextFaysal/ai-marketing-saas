import { Module } from "@nestjs/common";
import { TranslationsController } from "./translations.controller";
import { TranslationsService } from "./translations.service";
import { AuditModule } from "../audit/audit.module";
import { LlmFactory } from "../ai/llm/llm.factory";

/**
 * NF5 (FB3) — Multi-language + multi-currency storefront.
 * Dependencies ride EXISTING machinery only: PrismaService
 * (global), AuditService, and LlmFactory — provided here as its
 * own instance constructed by Nest with the global PrismaService
 * (LlmFactory's constructor takes @Optional() Prisma; AiModule
 * keeps its own instance, both resolve org LLM config through
 * the same CC8 path — no new provider, no key handling here).
 * The public read side (public-translations.ts) is a set of
 * prisma-handle functions StorefrontService calls directly, so
 * StorefrontModule needs no import edge to this module and the
 * graph stays acyclic.
 */
@Module({
  imports: [AuditModule],
  controllers: [TranslationsController],
  providers: [TranslationsService, LlmFactory],
  exports: [TranslationsService],
})
export class TranslationsModule {}
