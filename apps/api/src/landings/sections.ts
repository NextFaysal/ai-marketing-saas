import { BadRequestException } from "@nestjs/common";

/**
 * EC13 — landing-page section validator.
 *
 * A landing's `sections` Json is a fixed block list: only the
 * block types below may appear (no arbitrary HTML / components —
 * the public renderer maps each type to a known block). Input is
 * an array of { type, enabled?, order?, data? }; the output is
 * normalized: `enabled` defaults to true, `order` defaults to the
 * input index, and the list is sorted by `order`. The whole
 * payload is bounded (~20KB of JSON) so a landing row can never
 * become an unbounded document store.
 */

export const SECTION_TYPES = [
  "hero",
  "description",
  "benefits",
  "gallery",
  "reviews",
  "faq",
  "offer",
  "trust",
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export interface LandingSection {
  type: SectionType;
  enabled: boolean;
  order: number;
  data: Record<string, unknown>;
}

export const MAX_SECTIONS_JSON_LENGTH = 20_000;
const MAX_SECTIONS = 50;

export function defaultSections(): LandingSection[] {
  return SECTION_TYPES.map((type, i) => ({ type, enabled: true, order: i, data: {} }));
}

function bad(message: string): BadRequestException {
  return new BadRequestException(message);
}

function asObject(value: unknown, label: string): Record<string, any> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw bad(`${label} অবশ্যই একটি অবজেক্ট হতে হবে`);
  }
  return value as Record<string, any>;
}

function optString(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw bad(`${field} অবশ্যই লেখা (string) হতে হবে`);
  if (value.length > max) throw bad(`${field} সর্বোচ্চ ${max} অক্ষরের হতে পারবে`);
  return value;
}

function itemList(data: Record<string, any>, max: number, label: string): any[] {
  if (data.items === undefined || data.items === null) return [];
  if (!Array.isArray(data.items)) throw bad(`${label}.items অবশ্যই একটি তালিকা হতে হবে`);
  if (data.items.length > max) {
    throw bad(`${label}-এ সর্বোচ্চ ${max}টি আইটেম থাকতে পারবে`);
  }
  return data.items;
}

function validateData(type: SectionType, rawData: unknown): Record<string, unknown> {
  const data = asObject(rawData, `sections.${type}.data`);
  switch (type) {
    case "benefits": {
      const items = itemList(data, 8, "benefits").map((raw, i) => {
        const item = asObject(raw, `benefits.items[${i}]`);
        const title = optString(item.title, "benefits item.title", 200);
        const text = optString(item.text, "benefits item.text", 500);
        if (!title?.trim() && !text?.trim()) {
          throw bad(`benefits.items[${i}]-এ title অথবা text — অন্তত একটি দিতে হবে`);
        }
        return {
          ...(item.icon !== undefined
            ? { icon: optString(item.icon, "benefits item.icon", 100) }
            : {}),
          ...(title !== undefined ? { title } : {}),
          ...(text !== undefined ? { text } : {}),
        };
      });
      return { ...data, items };
    }
    case "faq": {
      const items = itemList(data, 10, "faq").map((raw, i) => {
        const item = asObject(raw, `faq.items[${i}]`);
        const q = optString(item.q, "faq item.q", 500);
        const a = optString(item.a, "faq item.a", 2000);
        if (!q?.trim() || !a?.trim()) {
          throw bad(`faq.items[${i}]-এ q এবং a দুটোই দিতে হবে`);
        }
        return { q, a };
      });
      return { ...data, items };
    }
    case "trust": {
      const out: Record<string, unknown> = { ...data };
      for (const field of ["codText", "deliveryText", "returnText"] as const) {
        const v = optString(data[field], `trust.${field}`, 300);
        if (v === undefined) delete out[field];
        else out[field] = v;
      }
      return out;
    }
    case "offer": {
      const out: Record<string, unknown> = { ...data };
      if (data.showBump !== undefined) {
        if (typeof data.showBump !== "boolean") throw bad("offer.showBump অবশ্যই boolean হতে হবে");
        out.showBump = data.showBump;
      }
      return out;
    }
    case "description": {
      const out: Record<string, unknown> = { ...data };
      const text = optString(data.text, "description.text", 5000);
      if (text === undefined) delete out.text;
      else out.text = text;
      return out;
    }
    default:
      // hero / gallery / reviews: data is ignored by the domain
      // rules but still bounded by the total-payload cap below.
      return { ...data };
  }
}

export function validateSections(input: unknown): LandingSection[] {
  if (!Array.isArray(input)) {
    throw bad("sections অবশ্যই একটি তালিকা (array) হতে হবে");
  }
  if (input.length > MAX_SECTIONS) {
    throw bad(`sections সর্বোচ্চ ${MAX_SECTIONS}টি হতে পারবে`);
  }
  let jsonLength = 0;
  try {
    jsonLength = JSON.stringify(input)?.length ?? 0;
  } catch {
    throw bad("sections বৈধ JSON নয়");
  }
  if (jsonLength > MAX_SECTIONS_JSON_LENGTH) {
    throw bad(`sections-এর মোট আকার সর্বোচ্চ ${MAX_SECTIONS_JSON_LENGTH} অক্ষর হতে পারবে`);
  }

  const normalized = input.map((raw, idx) => {
    const row = asObject(raw, `sections[${idx}]`);
    const type = row.type as SectionType;
    if (!(SECTION_TYPES as readonly string[]).includes(String(type))) {
      throw bad(`অজানা section ধরন: ${String(row.type)}`);
    }
    const order =
      typeof row.order === "number" && Number.isFinite(row.order) ? row.order : idx;
    return {
      type,
      enabled: row.enabled === undefined ? true : !!row.enabled,
      order,
      data: validateData(type, row.data),
    } satisfies LandingSection;
  });
  return normalized.sort((a, b) => a.order - b.order);
}

/** Stored sections → normalized list; null/undefined ⇒ defaults. */
export function normalizeSections(input: unknown): LandingSection[] {
  if (input === undefined || input === null) return defaultSections();
  return validateSections(input);
}
