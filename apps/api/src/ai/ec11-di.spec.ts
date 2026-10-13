import { Global, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AiModule } from "./ai.module";
import { ProposalsService } from "./proposals.service";
import { ProactiveService } from "./proactive.service";
import { ProductsService } from "../products/products.service";
import { InventoryService } from "../inventory/inventory.service";
import { CommerceService } from "../commerce/commerce.service";
import { DiscountsService } from "../commerce/discounts.service";
import { CommerceAnalyticsService } from "../commerce/commerce-analytics.service";
import { LlmFactory } from "./llm/llm.factory";
import { PrismaService } from "../prisma/prisma.service";
import { AuditModule } from "../audit/audit.module";

describe("EC11 AiModule graph", () => {
  it("resolves commerce deps into ProposalsService + ProactiveService", async () => {
    const fakePrisma: any = { auditLog: { create: jest.fn(async () => ({})) } };
    @Global()
    @Module({ providers: [{ provide: PrismaService, useValue: fakePrisma }], exports: [PrismaService] })
    class FakePrismaModule {}
    @Module({ imports: [FakePrismaModule, AuditModule, AiModule] })
    class Root {}
    const ctx = await NestFactory.createApplicationContext(Root, { logger: false });
    try {
      const proposals: any = ctx.get(ProposalsService);
      expect(proposals.products).toBeInstanceOf(ProductsService);
      expect(proposals.inventory).toBeInstanceOf(InventoryService);
      expect(proposals.commerce).toBeInstanceOf(CommerceService);
      expect(proposals.discounts).toBeInstanceOf(DiscountsService);
      expect(proposals.llmFactory).toBeInstanceOf(LlmFactory);
      const proactive: any = ctx.get(ProactiveService);
      expect(proactive.commerceAnalytics).toBeInstanceOf(CommerceAnalyticsService);
    } finally {
      await ctx.close();
    }
  });
});
