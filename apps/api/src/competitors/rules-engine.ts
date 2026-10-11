export type DynamicRuleTriggerType = 
  | "COMPETITOR_STOCK_OUT"
  | "COMPETITOR_PRICE_DROP"
  | "COMPETITOR_PRICE_INCREASE"
  | "COMPETITOR_NEW_WINNING_AD";

export type DynamicRuleActionType =
  | "BOOST_AD_BUDGET"
  | "SUGGEST_PRICE_MATCH"
  | "TRIGGER_FLASH_SALE_BUNDLE"
  | "PAUSE_UNDERPERFORMING_ADS";

export interface DynamicPricingRule {
  id: string;
  name: string;
  triggerType: DynamicRuleTriggerType;
  actionType: DynamicRuleActionType;
  conditions: {
    priceDropThresholdPercent?: number; // e.g. 10 means if competitor drops price by >= 10%
    priceIncreaseThresholdPercent?: number; // e.g. 15 means if competitor increases price by >= 15%
    competitorId?: string; // specific competitor or any
    targetProductId?: string; // specific product or all
  };
  actions: {
    budgetBoostPercent?: number; // e.g. 20 means boost ad budget by +20%
    priceAdjustmentPercent?: number; // e.g. -5 means price 5% lower or matching
    suggestedHeadline?: string;
  };
  enabled: boolean;
  lastTriggeredAt?: string | null;
  triggerCount: number;
  recentExecutions?: {
    timestamp: string;
    description: string;
    status: "EXECUTED" | "SIMULATED" | "SKIPPED";
  }[];
}

export interface RuleEvaluationResult {
  ruleId: string;
  ruleName: string;
  matched: boolean;
  actionTaken: string;
  suggestedActionPayload: Record<string, unknown>;
  timestamp: string;
}

export class RulesEngine {
  private static defaultRules: DynamicPricingRule[] = [
    {
      id: "rule-stockout-conquest",
      name: "Out-of-Stock Conquest (স্টক-আউট ব্লাস্ট)",
      triggerType: "COMPETITOR_STOCK_OUT",
      actionType: "BOOST_AD_BUDGET",
      conditions: {},
      actions: {
        budgetBoostPercent: 25,
        suggestedHeadline: "প্রতিযোগী স্টক শেষ! আমাদের ক্যাম্পেইন বাজেট ২৫% বৃদ্ধি করে মার্কেট দখল করুন",
      },
      enabled: true,
      triggerCount: 3,
      lastTriggeredAt: new Date(Date.now() - 3600 * 4000).toISOString(),
      recentExecutions: [
        {
          timestamp: new Date(Date.now() - 3600 * 4000).toISOString(),
          description: "দারাজ এ প্রিমিয়াম লেদার ওয়ালেট স্টক শেষ হওয়ায় ক্যাম্পেইন বাজেট ২৫% বুস্ট করা হয়েছে।",
          status: "EXECUTED",
        },
      ],
    },
    {
      id: "rule-price-drop-defense",
      name: "Price Undercut Defense (কাউন্টার ডিসকাউন্ট সুরক্ষা)",
      triggerType: "COMPETITOR_PRICE_DROP",
      actionType: "TRIGGER_FLASH_SALE_BUNDLE",
      conditions: {
        priceDropThresholdPercent: 10,
      },
      actions: {
        priceAdjustmentPercent: -8,
        suggestedHeadline: "প্রতিযোগী ১০% দাম কমিয়েছে! কাউন্টার ৩-প্যাক বান্ডেল অফার অফার করুন",
      },
      enabled: true,
      triggerCount: 1,
      lastTriggeredAt: new Date(Date.now() - 3600 * 24000).toISOString(),
      recentExecutions: [
        {
          timestamp: new Date(Date.now() - 3600 * 24000).toISOString(),
          description: "প্রতিযোগী দাম ১২% হ্রাস করায় ৩-প্যাক বান্ডেল সেভিং অফার অ্যালার্ট চালু হয়েছে।",
          status: "EXECUTED",
        },
      ],
    },
    {
      id: "rule-price-hike-harvest",
      name: "Competitor Price Hike Harvest (মুনাফা বৃদ্ধির সুযোগ)",
      triggerType: "COMPETITOR_PRICE_INCREASE",
      actionType: "BOOST_AD_BUDGET",
      conditions: {
        priceIncreaseThresholdPercent: 10,
      },
      actions: {
        budgetBoostPercent: 15,
        suggestedHeadline: "প্রতিযোগী দাম বাড়িয়েছে! আমাদের অফারে ক্যাম্পেইন স্কেল করুন",
      },
      enabled: false,
      triggerCount: 0,
      lastTriggeredAt: null,
      recentExecutions: [],
    },
    {
      id: "rule-winning-ad-counter",
      name: "Winning Ad Fast Counter (উইনিং অ্যাড কাউন্টার স্ট্র্যাটেজি)",
      triggerType: "COMPETITOR_NEW_WINNING_AD",
      actionType: "TRIGGER_FLASH_SALE_BUNDLE",
      conditions: {},
      actions: {
        suggestedHeadline: "প্রতিযোগীর বিজ্ঞাপন ভাইরাল হচ্ছে! স্ক্রিপ্ট ডিকনস্ট্রাক্ট করে কাউন্টার অ্যাড রান করুন",
      },
      enabled: true,
      triggerCount: 2,
      lastTriggeredAt: new Date(Date.now() - 3600 * 12000).toISOString(),
      recentExecutions: [
        {
          timestamp: new Date(Date.now() - 3600 * 12000).toISOString(),
          description: "প্রতিযোগীর নতুন ৩-দিনের ভাইরাল UGC অ্যাডের জবাবে কাউন্টার অ্যাড জেনারেট করা হয়েছে।",
          status: "EXECUTED",
        },
      ],
    },
  ];

  static getDefaultRules(): DynamicPricingRule[] {
    return JSON.parse(JSON.stringify(this.defaultRules));
  }

  static evaluateEvent(
    rules: DynamicPricingRule[],
    event: {
      type: DynamicRuleTriggerType;
      competitorName: string;
      productName: string;
      percentageChange?: number;
    },
  ): RuleEvaluationResult[] {
    const results: RuleEvaluationResult[] = [];

    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (rule.triggerType !== event.type) continue;

      let matched = true;
      if (
        event.type === "COMPETITOR_PRICE_DROP" &&
        rule.conditions.priceDropThresholdPercent &&
        (event.percentageChange ?? 0) < rule.conditions.priceDropThresholdPercent
      ) {
        matched = false;
      }

      if (
        event.type === "COMPETITOR_PRICE_INCREASE" &&
        rule.conditions.priceIncreaseThresholdPercent &&
        (event.percentageChange ?? 0) < rule.conditions.priceIncreaseThresholdPercent
      ) {
        matched = false;
      }

      if (matched) {
        rule.triggerCount += 1;
        rule.lastTriggeredAt = new Date().toISOString();

        let actionDesc = "";
        if (rule.actionType === "BOOST_AD_BUDGET") {
          actionDesc = `স্বয়ংক্রিয়ভাবে অ্যাক্টিভ ক্যাম্পেইন বাজেট +${rule.actions.budgetBoostPercent || 20}% বৃদ্ধি বা স্কেলিং সুপারিশ ট্রিগার হয়েছে (${event.competitorName} - ${event.productName})`;
        } else if (rule.actionType === "TRIGGER_FLASH_SALE_BUNDLE") {
          actionDesc = `কাউন্টার অফার ও বান্ডেল সেভিং নোটিফিকেশন পাঠানো হয়েছে (${event.competitorName})`;
        } else {
          actionDesc = `ডায়নামিক প্রাইসিং অ্যাকশন কার্যকর হয়েছে: ${rule.name}`;
        }

        if (!rule.recentExecutions) rule.recentExecutions = [];
        rule.recentExecutions.unshift({
          timestamp: new Date().toISOString(),
          description: actionDesc,
          status: "EXECUTED",
        });
        if (rule.recentExecutions.length > 10) rule.recentExecutions.pop();

        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          matched: true,
          actionTaken: actionDesc,
          suggestedActionPayload: {
            boostPercent: rule.actions.budgetBoostPercent,
            priceAdjustmentPercent: rule.actions.priceAdjustmentPercent,
            event,
          },
          timestamp: new Date().toISOString(),
        });
      }
    }

    return results;
  }
}
