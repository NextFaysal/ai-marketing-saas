import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { classifyShipmentStatus } from "./courier-performance";

export interface CourierScorecard {
  provider: "steadfast" | "pathao" | "redx" | string;
  courierAccountId: string | null;
  overallScore: number; // 0 - 100
  deliveryRate: number | null; // e.g. 0.92 = 92%
  returnRate: number | null;
  sampleSize: number;
  speedRating: "fast" | "standard" | "moderate";
  estimatedTurnaround: string;
  recommendationReason: string;
  isWinner: boolean;
}

export interface SmartRoutingResult {
  orderId: string;
  district: string;
  isInsideDhaka: boolean;
  recommendedProvider: string;
  recommendedCourierAccountId: string | null;
  confidence: "high" | "medium" | "benchmark";
  summaryReason: string;
  scorecards: CourierScorecard[];
}

export const BD_DISTRICTS = [
  "Dhaka", "Chittagong", "Gazipur", "Narayanganj", "Sylhet", "Rajshahi",
  "Khulna", "Barisal", "Rangpur", "Mymensingh", "Cumilla", "Bogra",
  "Noakhali", "Feni", "Brahmanbaria", "Cox's Bazar", "Jessore", "Dinajpur",
  "Tangail", "Sirajganj", "Pabna", "Faridpur", "Kushtia", "Jamalpur"
] as const;

/**
 * Extracts a normalized Bangladesh district name from address string
 */
export function extractDistrictFromAddress(text?: string | null): string {
  if (!text) return "Dhaka"; // Fallback default
  const lower = text.toLowerCase();

  const districtMap: Record<string, string> = {
    dhaka: "Dhaka",
    ঢাকা: "Dhaka",
    chittagong: "Chittagong",
    chattogram: "Chittagong",
    চট্টগ্রাম: "Chittagong",
    gazipur: "Gazipur",
    গাজীপুর: "Gazipur",
    narayanganj: "Narayanganj",
    নারায়ণগঞ্জ: "Narayanganj",
    নারায়ণগঞ্জ: "Narayanganj",
    sylhet: "Sylhet",
    সিলেট: "Sylhet",
    rajshahi: "Rajshahi",
    রাজশাহী: "Rajshahi",
    khulna: "Khulna",
    খুলনা: "Khulna",
    barisal: "Barisal",
    বরিশাল: "Barisal",
    rangpur: "Rangpur",
    রংপুর: "Rangpur",
    mymensingh: "Mymensingh",
    ময়মনসিংহ: "Mymensingh",
    কুমিল্লা: "Cumilla",
    comilla: "Cumilla",
    cumilla: "Cumilla",
    bogra: "Bogra",
    বগুড়া: "Bogra",
    noakhali: "Noakhali",
    নোয়াখালী: "Noakhali",
    feni: "Feni",
    ফেনী: "Feni",
    brahmanbaria: "Brahmanbaria",
    ব্রাহ্মণবাড়িয়া: "Brahmanbaria",
    "cox's bazar": "Cox's Bazar",
    coxsbazar: "Cox's Bazar",
    কক্সবাজার: "Cox's Bazar",
    jessore: "Jessore",
    যশোর: "Jessore",
    dinajpur: "Dinajpur",
    দিনাজপুর: "Dinajpur",
    tangail: "Tangail",
    টাঙ্গাইল: "Tangail",
    sirajganj: "Sirajganj",
    সিরাজগঞ্জ: "Sirajganj",
    pabna: "Pabna",
    পাবনা: "Pabna",
    faridpur: "Faridpur",
    ফরিদপুর: "Faridpur",
    kushtia: "Kushtia",
    কুষ্টিয়া: "Kushtia",
    jamalpur: "Jamalpur",
    জামালপুর: "Jamalpur",
  };

  for (const [key, normalized] of Object.entries(districtMap)) {
    if (lower.includes(key)) return normalized;
  }

  return "Dhaka";
}

@Injectable()
export class CourierOptimizerService {
  private readonly logger = new Logger(CourierOptimizerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Evaluates best courier for a specific order based on real historical
   * performance in that recipient's district + national logistics benchmarks.
   */
  async getSmartRouting(
    organizationId: string,
    orderId: string,
  ): Promise<SmartRoutingResult> {
    const order = await (this.prisma as any).order.findFirst({
      where: { id: orderId, organizationId },
      include: {
        customer: true,
      },
    });

    if (!order) {
      throw new NotFoundException("অর্ডারটি পাওয়া যায়নি");
    }

    // Determine district
    let rawAddress = order.address || "";
    if (!rawAddress && order.customer?.address) {
      const ca = order.customer.address;
      rawAddress = typeof ca === "string" ? ca : JSON.stringify(ca);
    }

    const district = extractDistrictFromAddress(rawAddress);
    const isInsideDhaka = district.toLowerCase() === "dhaka";

    // Load active courier accounts for this org
    const integrations = await (this.prisma as any).integration.findMany({
      where: {
        organizationId,
        provider: { in: ["steadfast", "pathao", "redx"] },
        status: "connected",
      },
    });

    const activeProviders = integrations.length > 0
      ? integrations.map((i: any) => ({ provider: i.provider, id: i.id }))
      : [
          { provider: "steadfast", id: null },
          { provider: "pathao", id: null },
          { provider: "redx", id: null },
        ];

    // Compute historical stats for this district
    const historicalStats = await this.getDistrictStats(organizationId, district);

    // Build Scorecards
    const scorecards: CourierScorecard[] = [];

    for (const item of activeProviders) {
      const prov = item.provider;
      const stats = historicalStats[prov];
      const sampleSize = stats?.decided ?? 0;

      let deliveryRate: number | null = null;
      let returnRate: number | null = null;

      if (sampleSize >= 3 && stats) {
        deliveryRate = stats.delivered / sampleSize;
        returnRate = stats.returned / sampleSize;
      }

      // Compute composite score (0 - 100)
      let score = 70; // baseline
      let speedRating: "fast" | "standard" | "moderate" = "standard";
      let estimatedTurnaround = isInsideDhaka ? "২৪-৪৮ ঘণ্টা" : "৪৮-৭২ ঘণ্টা";
      let reason = "";

      if (deliveryRate !== null && returnRate !== null) {
        // High confidence from real store data
        score = Math.round(deliveryRate * 80 + (1 - returnRate) * 20);
        reason = `${district} জেলায় আপনার স্টোরের সফল ডেলিভারি হার ${Math.round(
          deliveryRate * 100,
        )}% (নমুনা: ${sampleSize}টি পার্সেল)।`;
      } else {
        // Benchmark heuristics for BD
        if (prov === "pathao") {
          if (isInsideDhaka) {
            score = 94;
            speedRating = "fast";
            estimatedTurnaround = "১২-২৪ ঘণ্টা (Same-day / Next-day)";
            reason = "ঢাকা মেট্রো এলাকায় পাঠাও এর ডেলিভারি গতি ও গ্রহণযোগ্যতা সর্বোচ্চ।";
          } else {
            score = 78;
            speedRating = "standard";
            estimatedTurnaround = "৪৮-৭২ ঘণ্টা";
            reason = "ঢাকার বাইরে মাঝারি মানের কভারেজ ও সাব-হাব ডেলিভারি।";
          }
        } else if (prov === "steadfast") {
          if (isInsideDhaka) {
            score = 88;
            speedRating = "standard";
            estimatedTurnaround = "২৪-৩৬ ঘণ্টা";
            reason = "ঢাকা সিটির ভেতরে নিয়মিত ভালো ডেলিভারি সাকসেস।";
          } else {
            score = 93;
            speedRating = "standard";
            estimatedTurnaround = "৪৮-৭২ ঘণ্টা";
            reason = `${district} সহ দেশের সকল থানা ও উপজেলায় স্টিডফাস্টের সরাসরি ডেলিভারি নেটওয়ার্ক ও সর্বনিম্ন রিটার্ন রেট।`;
          }
        } else if (prov === "redx") {
          if (isInsideDhaka) {
            score = 82;
            speedRating = "standard";
            estimatedTurnaround = "২৪-৪৮ ঘণ্টা";
            reason = "ঢাকা সিটিতে নির্ভরযোগ্য কর্পোরেট ট্র্যাকিং ও হাব কানেক্টিভিটি।";
          } else {
            score = 75;
            speedRating = "moderate";
            estimatedTurnaround = "৭২-৯৬ ঘণ্টা";
            reason = "জেলা সদরের বাইরে প্রত্যন্ত অঞ্চলে ডেলিভারি সময় তুলনামূলক কিছুটা বেশি।";
          }
        }
      }

      scorecards.push({
        provider: prov,
        courierAccountId: item.id,
        overallScore: score,
        deliveryRate: deliveryRate ? Math.round(deliveryRate * 10000) / 10000 : null,
        returnRate: returnRate ? Math.round(returnRate * 10000) / 10000 : null,
        sampleSize,
        speedRating,
        estimatedTurnaround,
        recommendationReason: reason,
        isWinner: false,
      });
    }

    // Sort by score descending
    scorecards.sort((a, b) => b.overallScore - a.overallScore);
    if (scorecards.length > 0) {
      scorecards[0].isWinner = true;
    }

    const winner = scorecards[0];
    const confidence =
      winner.sampleSize >= 5
        ? "high"
        : winner.sampleSize >= 2
        ? "medium"
        : "benchmark";

    const providerBengali: Record<string, string> = {
      steadfast: "Steadfast Courier",
      pathao: "Pathao Courier",
      redx: "RedX Logistics",
    };

    const summaryReason = `স্মার্ট রেকমেন্ডেশন: ${
      providerBengali[winner.provider] || winner.provider
    } (স্কোর: ${winner.overallScore}/১০০) — ${winner.recommendationReason}`;

    return {
      orderId,
      district,
      isInsideDhaka,
      recommendedProvider: winner.provider,
      recommendedCourierAccountId: winner.courierAccountId,
      confidence,
      summaryReason,
      scorecards,
    };
  }

  /**
   * Internal helper: aggregates historical delivery and return counts
   * grouped by courier provider for shipments in a district.
   */
  private async getDistrictStats(
    organizationId: string,
    district: string,
  ): Promise<Record<string, { delivered: number; returned: number; decided: number }>> {
    const shipments = await (this.prisma as any).courierShipment.findMany({
      where: {
        organizationId,
        recipientAddress: {
          contains: district,
          mode: "insensitive",
        },
      },
      select: {
        provider: true,
        status: true,
      },
      take: 200,
    });

    const result: Record<string, { delivered: number; returned: number; decided: number }> = {};

    for (const sh of shipments) {
      const outcome = classifyShipmentStatus(sh.status);
      if (!result[sh.provider]) {
        result[sh.provider] = { delivered: 0, returned: 0, decided: 0 };
      }
      if (outcome === "delivered") {
        result[sh.provider].delivered += 1;
        result[sh.provider].decided += 1;
      } else if (outcome === "returned") {
        result[sh.provider].returned += 1;
        result[sh.provider].decided += 1;
      }
    }

    return result;
  }
}
