import { describe, it, expect } from "vitest";
import {
  identifyDistrictZone,
  recommendBestCourier,
  calculateRtoLoss,
  COURIER_PROVIDERS,
} from "./courier-analytics";

describe("courier-analytics engine", () => {
  it("identifies logistics zones accurately for Bangladeshi addresses", () => {
    expect(identifyDistrictZone("Mirpur-10, Dhaka").zone).toBe("dhaka_metro");
    expect(identifyDistrictZone("Uttara Sector 7").zone).toBe("dhaka_metro");
    expect(identifyDistrictZone("Savar, Gazipur").zone).toBe("dhaka_suburb");
    expect(identifyDistrictZone("Chittagong GEC Circle").zone).toBe("divisional_city");
    expect(identifyDistrictZone("Bandarban Sadar").zone).toBe("remote_district");
  });

  it("recommends Pathao for Dhaka Metro for maximum speed", () => {
    const rec = recommendBestCourier("Dhanmondi, Dhaka", 500, 1500, "speed");
    expect(rec.recommendedProvider).toBe("pathao");
    expect(rec.zone).toBe("dhaka_metro");
    expect(rec.estimatedCostTaka).toBe(60);
    expect(rec.estimatedDeliveryDays).toContain("১ দিন");
  });

  it("recommends Steadfast for Chittagong & Remote districts for high success rate", () => {
    const recChittagong = recommendBestCourier("Chittagong", 500, 2000);
    expect(recChittagong.recommendedProvider).toBe("steadfast");

    const recRemote = recommendBestCourier("Bandarban, Chittagong Hill Tracts");
    expect(recRemote.recommendedProvider).toBe("steadfast");
    expect(recRemote.zone).toBe("remote_district");
  });

  it("calculates RTO return financial losses and potential savings", () => {
    // 500 orders with 15% return rate
    const loss = calculateRtoLoss({
      totalShipments: 500,
      returnRatePct: 15,
      outboundShippingTaka: 120,
      returnFeeTaka: 60,
      packagingLossTaka: 30,
    });

    expect(loss.returnedOrdersCount).toBe(75);
    expect(loss.deliveredOrdersCount).toBe(425);
    expect(loss.shippingLossTaka).toBe(75 * 120); // 9,000
    expect(loss.returnFeeLossTaka).toBe(75 * 60); // 4,500
    expect(loss.packagingLossTaka).toBe(75 * 30); // 2,250
    expect(loss.totalNetLossTaka).toBe(15750);
    expect(loss.savingsWithAdvanceChargeTaka).toBeGreaterThan(5000);
    expect(loss.recommendationBangla).toContain("অগ্রিম ডেলিভারি চার্জ");
  });

  it("has valid courier provider specifications", () => {
    expect(COURIER_PROVIDERS.pathao.overallSuccessRate).toBeGreaterThan(90);
    expect(COURIER_PROVIDERS.steadfast.dhakaChargeTaka).toBe(70);
    expect(COURIER_PROVIDERS.redx.provider).toBe("redx");
  });
});
