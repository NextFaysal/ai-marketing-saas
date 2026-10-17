import { BadRequestException, HttpException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { LlmFactory, providerForOrg } from "../ai/llm/llm.factory";
import { killSwitches } from "../common/platform-settings";
import {
  LOCALE_PROMPT_NAMES, isTranslationLocale, parseRatePerUnit,
} from "./translations";
import type {
  AiProductDraftDto, AiStringsDraftDto, UpdateTranslationDto, UpsertCurrencyRateDto, UpsertTranslationDto,
} from "./translations.dto";

/**
 * NF5 (FB3) — staff-side translations + display currencies.
 *
 * Honesty rules (acceptance-pinned):
 * - AI drafts are created ONLY through the org's own LlmFactory
 *   provider (providerForOrg — the CC8 path every other AI
 *   feature uses). No new provider, no key in code.
 * - If the resolved provider is not a real LLM (the labelled dev
 *   template adapter, i.e. no working LLM config), generation
 *   fails with a clear Bengali error — a template "translation"
 *   is never fabricated.
 * - The platform AI kill switch (killSwitches.aiDisabledOrgIds)
 *   refuses generation with 403, the same rule as chat / voice.
 * - An AI draft is ALWAYS status "draft", source "ai" — approval
 *   is a separate, explicit human act. Only approved rows are
 *   served publicly (public-translations.ts filters on approved).
 * - Display-currency rates are human-entered with a required
 *   source note. Nothing fetches or implies a live FX rate.
 */

export const PRODUCT_TRANSLATION_FIELDS = ["name", "description"] as const;
export const STOREFRONT_STRING_FIELDS = ["announcementText", "returnPolicyText", "deliveryPromiseText"] as const;
export const STOREFRONT_STRINGS_ENTITY_ID = "shop";

const AI_DRAFT_NOTE_BN = "এটি AI-তৈরি খসড়া — অনুমোদন না করা পর্যন্ত দোকানে দেখাবে না। যাচাই করে অনুমোদন করুন।";
const NO_LLM_ERROR_BN = "AI অনুবাদ তৈরি করা যায়নি — এই সংস্থার জন্য কোনো সক্রিয় AI মডেল কনফিগার করা নেই। অনুগ্রহ করে নিজে অনুবাদ লিখুন, অথবা সংযোগ সেটিংসে AI মডেল যাচাই করুন।";

@Injectable()
export class TranslationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly llm?: LlmFactory,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private db(): any { return this.prisma as any; }

  private async safeAudit(input: Parameters<AuditService["log"]>[0]) {
    await this.audit?.log(input).catch(() => undefined);
  }

  private serialize(row: any) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      entityType: row.entityType,
      entityId: row.entityId,
      field: row.field,
      locale: row.locale,
      text: row.text,
      status: row.status,
      source: row.source,
      createdById: row.createdById ?? null,
      updatedById: row.updatedById ?? null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    };
  }

  // ---------- shared validation ----------

  private assertLocale(locale: unknown): string {
    if (!isTranslationLocale(locale)) {
      throw new BadRequestException("ভাষা অবশ্যই bn, en অথবা hi হতে হবে");
    }
    return locale;
  }

  private assertEntity(entityType: unknown, field: unknown): { entityType: string; field: string } {
    if (entityType === "product") {
      if (!(PRODUCT_TRANSLATION_FIELDS as readonly string[]).includes(String(field))) {
        throw new BadRequestException("পণ্যের জন্য ক্ষেত্র শুধু name অথবা description হতে পারে");
      }
      return { entityType: "product", field: String(field) };
    }
    if (entityType === "storefront_string") {
      if (!(STOREFRONT_STRING_FIELDS as readonly string[]).includes(String(field))) {
        throw new BadRequestException(`দোকানের লেখার জন্য ক্ষেত্র শুধু ${STOREFRONT_STRING_FIELDS.join(", ")} হতে পারে`);
      }
      return { entityType: "storefront_string", field: String(field) };
    }
    throw new BadRequestException("entityType অবশ্যই product অথবা storefront_string হতে হবে");
  }

  private async productOr404(orgId: string, productId: string) {
    const product = await this.db().product.findFirst({ where: { id: productId, organizationId: orgId } });
    if (!product) throw new NotFoundException("পণ্যটি এই সংস্থায় পাওয়া যায়নি");
    return product;
  }

  // ---------- staff reads ----------

  async listForProduct(orgId: string, productId: string) {
    await this.productOr404(orgId, productId);
    const rows = await this.db().contentTranslation.findMany({
      where: { organizationId: orgId, entityType: "product", entityId: productId },
      orderBy: [{ locale: "asc" }, { field: "asc" }],
    });
    return { items: rows.map((r: any) => this.serialize(r)) };
  }

  async listStorefrontStrings(orgId: string) {
    const rows = await this.db().contentTranslation.findMany({
      where: { organizationId: orgId, entityType: "storefront_string", entityId: STOREFRONT_STRINGS_ENTITY_ID },
      orderBy: [{ locale: "asc" }, { field: "asc" }],
    });
    return { items: rows.map((r: any) => this.serialize(r)) };
  }

  // ---------- human create / edit / approve ----------

  /**
   * Create or replace ONE translation as a human (source "human").
   * Status is honoured only when explicitly sent — a save never
   * silently approves; the panel's approve action sends
   * status "approved" explicitly.
   */
  async upsertHuman(orgId: string, userId: string, dto: UpsertTranslationDto) {
    const { entityType, field } = this.assertEntity(dto.entityType, dto.field);
    const locale = this.assertLocale(dto.locale);
    const text = typeof dto.text === "string" ? dto.text.trim() : "";
    if (!text) throw new BadRequestException("অনুবাদের লেখা খালি হতে পারে না");
    const entityId = entityType === "product" ? String(dto.entityId ?? "") : STOREFRONT_STRINGS_ENTITY_ID;
    if (entityType === "product") await this.productOr404(orgId, entityId);
    const status = dto.status === "approved" ? "approved" : "draft";
    const where = { organizationId_entityType_entityId_field_locale: { organizationId: orgId, entityType, entityId, field, locale } };
    const row = await this.db().contentTranslation.upsert({
      where,
      create: { organizationId: orgId, entityType, entityId, field, locale, text, status, source: "human", createdById: userId, updatedById: userId },
      update: { text, status, source: "human", updatedById: userId },
    });
    await this.safeAudit({
      organizationId: orgId, userId, action: "translation.upsert", entityType: "ContentTranslation", entityId: row.id,
      metadata: { entityType, entityId, field, locale, status, source: "human" },
    });
    return this.serialize(row);
  }

  async updateTranslation(orgId: string, userId: string, id: string, dto: UpdateTranslationDto) {
    const row = await this.db().contentTranslation.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException("অনুবাদটি পাওয়া যায়নি");
    const data: Record<string, unknown> = { updatedById: userId };
    if (dto.text !== undefined) {
      const text = typeof dto.text === "string" ? dto.text.trim() : "";
      if (!text) throw new BadRequestException("অনুবাদের লেখা খালি হতে পারে না");
      data.text = text;
    }
    if (dto.status !== undefined) {
      if (dto.status !== "approved" && dto.status !== "draft") {
        throw new BadRequestException("status শুধু draft অথবা approved হতে পারে");
      }
      data.status = dto.status;
    }
    const updated = await this.db().contentTranslation.update({ where: { id: row.id }, data });
    await this.safeAudit({
      organizationId: orgId, userId,
      action: updated.status === "approved" && row.status !== "approved" ? "translation.approve" : "translation.update",
      entityType: "ContentTranslation", entityId: row.id,
      metadata: { field: row.field, locale: row.locale, status: updated.status },
    });
    return this.serialize(updated);
  }

  // ---------- AI drafts (LlmFactory / OrgBrain path only) ----------

  private async realProviderOrFail(orgId: string) {
    const ks = await killSwitches(this.prisma as any).catch(() => ({ aiDisabledOrgIds: [] as string[] }));
    if (ks.aiDisabledOrgIds.includes(orgId)) {
      throw new HttpException("এই সংস্থার জন্য AI সুবিধা প্ল্যাটফর্ম টিম সাময়িকভাবে বন্ধ রেখেছে।", 403);
    }
    if (!this.llm) throw new BadRequestException(NO_LLM_ERROR_BN);
    const provider = await providerForOrg(this.llm, orgId).catch(() => null);
    // The dev-template adapter is NOT a translator: with no real
    // LLM configured we fail honestly instead of storing a
    // fabricated "translation".
    if (!provider || !provider.isRealLlm) throw new BadRequestException(NO_LLM_ERROR_BN);
    return provider;
  }

  private async translateFields(
    orgId: string,
    userId: string,
    provider: any,
    locale: string,
    fields: { field: string; baseText: string }[],
    feature: string,
  ): Promise<Record<string, string>> {
    const langName = LOCALE_PROMPT_NAMES[locale] ?? locale;
    const payload = Object.fromEntries(fields.map((f) => [f.field, f.baseText]));
    let result: any;
    try {
      result = await provider.complete(
        [
          {
            role: "system",
            content: [
              `You translate ecommerce storefront content into ${langName}.`,
              "Translate ONLY the given texts. Preserve prices, numbers, phone numbers, brand names and URLs exactly. Never invent features, discounts or promises that are not in the source text.",
              `Return ONLY a JSON object with exactly these keys: ${fields.map((f) => `"${f.field}"`).join(", ")} — each value the translated string.`,
            ].join("\n"),
          },
          { role: "user", content: JSON.stringify(payload) },
        ],
        { jsonMode: true, maxTokens: 1500 },
      );
    } catch (e: any) {
      throw new BadRequestException(`AI অনুবাদ তৈরি করা যায়নি: ${e?.message ?? String(e)}`);
    }
    await this.db().aIUsageRecord.create({
      data: {
        organizationId: orgId, userId, feature,
        provider: provider.name, model: result.model,
        inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        estimated: result.tokensEstimated,
      },
    }).catch(() => undefined);
    let parsed: any = null;
    try { parsed = JSON.parse(result.text); } catch { parsed = null; }
    const out: Record<string, string> = {};
    for (const f of fields) {
      const v = typeof parsed?.[f.field] === "string" ? parsed[f.field].trim() : "";
      if (v) out[f.field] = v;
    }
    if (Object.keys(out).length === 0) {
      throw new BadRequestException("AI অনুবাদ তৈরি করা যায়নি — মডেল কোনো ব্যবহারযোগ্য অনুবাদ দেয়নি। আবার চেষ্টা করুন অথবা নিজে লিখুন।");
    }
    return out;
  }

  private async saveDrafts(
    orgId: string, userId: string, entityType: string, entityId: string,
    locale: string, translated: Record<string, string>,
  ) {
    const saved: any[] = [];
    for (const [field, text] of Object.entries(translated)) {
      const where = { organizationId_entityType_entityId_field_locale: { organizationId: orgId, entityType, entityId, field, locale } };
      const row = await this.db().contentTranslation.upsert({
        where,
        // HARD RULE: an AI draft is ALWAYS draft + source "ai" —
        // even when it replaces a previously approved row, the
        // replacement goes back to draft and stops being served
        // until a human approves it again.
        create: { organizationId: orgId, entityType, entityId, field, locale, text, status: "draft", source: "ai", createdById: userId, updatedById: userId },
        update: { text, status: "draft", source: "ai", updatedById: userId },
      });
      saved.push(row);
    }
    await this.safeAudit({
      organizationId: orgId, userId, action: "translation.ai_draft", entityType: "ContentTranslation",
      metadata: { entityType, entityId, locale, fields: Object.keys(translated) },
    });
    return saved;
  }

  async generateProductDraft(orgId: string, userId: string, productId: string, dto: AiProductDraftDto) {
    const locale = this.assertLocale(dto.locale);
    const product = await this.productOr404(orgId, productId);
    const provider = await this.realProviderOrFail(orgId);
    const fields = [
      { field: "name", baseText: String(product.name ?? "") },
      ...(product.description ? [{ field: "description", baseText: String(product.description) }] : []),
    ].filter((f) => f.baseText.trim());
    if (fields.length === 0) throw new BadRequestException("এই পণ্যের কোনো নাম/বিবরণ নেই — আগে পণ্যের তথ্য যোগ করুন");
    const translated = await this.translateFields(orgId, userId, provider, locale, fields, "product_translation");
    const saved = await this.saveDrafts(orgId, userId, "product", productId, locale, translated);
    return {
      mode: "ai_draft" as const,
      provider: provider.name,
      note: AI_DRAFT_NOTE_BN,
      items: saved.map((r: any) => this.serialize(r)),
    };
  }

  async generateStringsDraft(orgId: string, userId: string, dto: AiStringsDraftDto) {
    const locale = this.assertLocale(dto.locale);
    const provider = await this.realProviderOrFail(orgId);
    const setting = await this.db().storefrontSetting.findUnique({ where: { organizationId: orgId } }).catch(() => null);
    const wanted = Array.isArray(dto.fields) && dto.fields.length
      ? dto.fields.filter((f) => (STOREFRONT_STRING_FIELDS as readonly string[]).includes(f))
      : [...STOREFRONT_STRING_FIELDS];
    const fields = wanted
      .map((field) => ({ field, baseText: typeof setting?.[field] === "string" ? setting[field] : "" }))
      .filter((f) => f.baseText.trim());
    if (fields.length === 0) {
      throw new BadRequestException("দোকানের কোনো মূল লেখা (ঘোষণা/রিটার্ন নীতি/ডেলিভারি প্রতিশ্রুতি) সেট করা নেই — আগে স্টোরফ্রন্ট সেটিংসে লেখা যোগ করুন");
    }
    const translated = await this.translateFields(orgId, userId, provider, locale, fields, "storefront_translation");
    const saved = await this.saveDrafts(orgId, userId, "storefront_string", STOREFRONT_STRINGS_ENTITY_ID, locale, translated);
    return {
      mode: "ai_draft" as const,
      provider: provider.name,
      note: AI_DRAFT_NOTE_BN,
      items: saved.map((r: any) => this.serialize(r)),
    };
  }

  // ---------- display currencies (human-entered rates only) ----------

  private async baseCurrencyOf(orgId: string): Promise<string> {
    const org = await this.db().organization.findUnique({ where: { id: orgId } }).catch(() => null);
    return String(org?.currency ?? "BDT").toUpperCase();
  }

  private serializeRate(row: any, baseCurrency: string) {
    return {
      currency: row.currency,
      ratePerUnit: row.ratePerUnit,
      sourceNote: row.sourceNote,
      baseCurrency,
      updatedById: row.updatedById ?? null,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    };
  }

  async listCurrencyRates(orgId: string) {
    const baseCurrency = await this.baseCurrencyOf(orgId);
    const rows = await this.db().displayCurrencyRate.findMany({
      where: { organizationId: orgId }, orderBy: { currency: "asc" },
    });
    return { baseCurrency, items: rows.map((r: any) => this.serializeRate(r, baseCurrency)) };
  }

  async upsertCurrencyRate(orgId: string, userId: string, dto: UpsertCurrencyRateDto) {
    const currency = String(dto.currency ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException("মুদ্রার কোড অবশ্যই ৩ অক্ষরের ISO কোড হতে হবে (যেমন USD)");
    const baseCurrency = await this.baseCurrencyOf(orgId);
    if (currency === baseCurrency) {
      throw new BadRequestException(`দোকানের মূল মুদ্রা (${baseCurrency}) নিজেই — এর জন্য আলাদা রেট লাগে না`);
    }
    const rate = parseRatePerUnit(dto.ratePerUnit as any);
    if (rate === null) throw new BadRequestException("রেট অবশ্যই ধনাত্মক সংখ্যা হতে হবে (যেমন 119.50)");
    const sourceNote = typeof dto.sourceNote === "string" ? dto.sourceNote.trim() : "";
    if (!sourceNote) throw new BadRequestException("রেটের উৎস লিখতে হবে — এই রেট কোথা থেকে নিয়েছেন (যেমন: ব্যাংকের আজকের রেট, নিজের হিসাব)");
    const ratePerUnit = String(dto.ratePerUnit).trim();
    const where = { organizationId_currency: { organizationId: orgId, currency } };
    const row = await this.db().displayCurrencyRate.upsert({
      where,
      create: { organizationId: orgId, currency, ratePerUnit, sourceNote, updatedById: userId },
      update: { ratePerUnit, sourceNote, updatedById: userId },
    });
    await this.safeAudit({
      organizationId: orgId, userId, action: "translation.currency_rate_upsert", entityType: "DisplayCurrencyRate", entityId: row.id,
      metadata: { currency, ratePerUnit, sourceNote },
    });
    return this.serializeRate(row, baseCurrency);
  }

  async deleteCurrencyRate(orgId: string, userId: string, currencyRaw: string) {
    const currency = String(currencyRaw ?? "").trim().toUpperCase();
    const row = await this.db().displayCurrencyRate.findFirst({ where: { organizationId: orgId, currency } });
    if (!row) throw new NotFoundException("এই মুদ্রার কোনো রেট সেট করা নেই");
    await this.db().displayCurrencyRate.delete({ where: { id: row.id } });
    await this.safeAudit({
      organizationId: orgId, userId, action: "translation.currency_rate_delete", entityType: "DisplayCurrencyRate", entityId: row.id,
      metadata: { currency },
    });
    return { deleted: true, currency };
  }
}
