/**
 * ML1/ML3 (Multi-Language MB1) + MB2 assembly — dashboard UI dictionary.
 *
 * bn is the source-of-truth shape; en MUST mirror it exactly
 * (same key set, no empty values — pinned by i18n.test.ts, which
 * also pins bn/en placeholder-set equality for parameterised
 * values since MB2 STEP-0).
 *
 * MB2: the dashboard namespaces live in per-namespace files in
 * this directory (common, shell, settings, connections, team,
 * agency, commerce, orders, pos, products, inventory, delivery,
 * inbox, messaging, crm, automations, workflows, ads,
 * campaignBuilder, ai, social, analytics, billing, misc, shared),
 * each exporting `XBn` / `XEn: typeof XBn`. This file ASSEMBLES
 * them into the single typed `Dict` the LocaleProvider serves,
 * and keeps the MB1 `settingsLanguage` namespace inline.
 *
 * This file intentionally does NOT import @repo/contracts
 * (not even at runtime): the dictionary must stay a pure,
 * dependency-free module so its tests never need a built
 * contracts dist. `UiLocale` below mirrors the canonical
 * `UiLocale` union exported by @repo/contracts (ML1).
 *
 * House rules: Bengali strings live ONLY in dictionary files
 * (this directory and the admin dictionary); components read
 * strings through the LocaleProvider's `dict`/`t`, never by
 * hardcoding copy. bn copy uses the আপনি tone and the fixed
 * project glossary; en copy is plain sentence case.
 */

import { commonBn, commonEn } from "./common";
import { shellBn, shellEn } from "./shell";
import { settingsBn, settingsEn } from "./settings";
import { connectionsBn, connectionsEn } from "./connections";
import { teamBn, teamEn } from "./team";
import { agencyBn, agencyEn } from "./agency";
import { commerceBn, commerceEn } from "./commerce";
import { ordersBn, ordersEn } from "./orders";
import { posBn, posEn } from "./pos";
import { productsBn, productsEn } from "./products";
import { inventoryBn, inventoryEn } from "./inventory";
import { deliveryBn, deliveryEn } from "./delivery";
import { inboxBn, inboxEn } from "./inbox";
import { messagingBn, messagingEn } from "./messaging";
import { crmBn, crmEn } from "./crm";
import { automationsBn, automationsEn } from "./automations";
import { workflowsBn, workflowsEn } from "./workflows";
import { adsBn, adsEn } from "./ads";
import { campaignBuilderBn, campaignBuilderEn } from "./campaignBuilder";
import { aiBn, aiEn } from "./ai";
import { socialBn, socialEn } from "./social";
import { analyticsBn, analyticsEn } from "./analytics";
import { billingBn, billingEn } from "./billing";
import { miscBn, miscEn } from "./misc";
import { sharedBn, sharedEn } from "./shared";

export type UiLocale = "bn" | "en";

const bnDict = {
  common: commonBn,
  shell: shellBn,
  settings: settingsBn,
  connections: connectionsBn,
  team: teamBn,
  agency: agencyBn,
  commerce: commerceBn,
  orders: ordersBn,
  pos: posBn,
  products: productsBn,
  inventory: inventoryBn,
  delivery: deliveryBn,
  inbox: inboxBn,
  messaging: messagingBn,
  crm: crmBn,
  automations: automationsBn,
  workflows: workflowsBn,
  ads: adsBn,
  campaignBuilder: campaignBuilderBn,
  ai: aiBn,
  social: socialBn,
  analytics: analyticsBn,
  billing: billingBn,
  misc: miscBn,
  shared: sharedBn,
  settingsLanguage: {
    title: "ভাষা",
    description:
      "ড্যাশবোর্ড কোন ভাষায় দেখবেন তা এখান থেকে বেছে নিন। আপনার নিজের পছন্দ সবার আগে প্রযোজ্য হবে; নিজের পছন্দ না থাকলে প্রতিষ্ঠানের ডিফল্ট ভাষা দেখাবে।",
    personalTitle: "আপনার নিজের ভাষা",
    personalHelp:
      "এই পছন্দটি শুধু আপনার অ্যাকাউন্টের জন্য — বেছে নিলেই সঙ্গে সঙ্গে চালু হয়ে যাবে এবং সংরক্ষিত থাকবে।",
    orgTitle: "প্রতিষ্ঠানের ডিফল্ট ভাষা",
    orgHelp:
      "যেসব সদস্যের নিজের কোনো ভাষা-পছন্দ নেই, তাঁদের ড্যাশবোর্ড এই ভাষায় দেখাবে।",
    orgSave: "প্রতিষ্ঠানের ভাষা সংরক্ষণ করুন",
    saved: "সংরক্ষিত হয়েছে।",
    saveError: "সংরক্ষণ করা যায়নি — আবার চেষ্টা করুন।",
    readOnlyNote:
      "শুধু প্রতিষ্ঠানের মালিক (OWNER) বা অ্যাডমিন (ADMIN) প্রতিষ্ঠানের ডিফল্ট ভাষা বদলাতে পারেন।",
    currentEffective: "বর্তমানে কার্যকর ভাষা",
    noOrg: "কোনো প্রতিষ্ঠান নির্বাচিত নেই।",
  },
};

export type Dict = typeof bnDict;

const enDict: Dict = {
  common: commonEn,
  shell: shellEn,
  settings: settingsEn,
  connections: connectionsEn,
  team: teamEn,
  agency: agencyEn,
  commerce: commerceEn,
  orders: ordersEn,
  pos: posEn,
  products: productsEn,
  inventory: inventoryEn,
  delivery: deliveryEn,
  inbox: inboxEn,
  messaging: messagingEn,
  crm: crmEn,
  automations: automationsEn,
  workflows: workflowsEn,
  ads: adsEn,
  campaignBuilder: campaignBuilderEn,
  ai: aiEn,
  social: socialEn,
  analytics: analyticsEn,
  billing: billingEn,
  misc: miscEn,
  shared: sharedEn,
  settingsLanguage: {
    title: "Language",
    description:
      "Choose the language the dashboard uses. Your personal preference comes first; if you have none, the organization default applies.",
    personalTitle: "Your language",
    personalHelp:
      "This preference applies only to your account — choosing an option applies and saves it right away.",
    orgTitle: "Organization default language",
    orgHelp:
      "Members who have not set a personal language preference will see the dashboard in this language.",
    orgSave: "Save organization language",
    saved: "Saved.",
    saveError: "Could not save — please try again.",
    readOnlyNote:
      "Only an organization OWNER or ADMIN can change the organization default language.",
    currentEffective: "Currently active language",
    noOrg: "No organization is selected.",
  },
};

export const dicts: Record<UiLocale, Dict> = { bn: bnDict, en: enDict };

/** Dictionary for a locale value; anything unknown falls back to bn. */
export function getDict(locale: unknown): Dict {
  return locale === "en" ? dicts.en : dicts.bn;
}

/** Normalize an unknown locale value to a UiLocale (default bn). */
export function localeOf(locale: unknown): UiLocale {
  return locale === "en" ? "en" : "bn";
}
