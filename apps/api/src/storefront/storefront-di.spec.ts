import { Global, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { StorefrontModule } from "./storefront.module";
import { StorefrontService } from "./storefront.service";
import { DiscountsService } from "../commerce/discounts.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { PrismaService } from "../prisma/prisma.service";

/**
 * EC8 — DI regression spec: proves the StorefrontModule graph
 * resolves in Nest (CommerceModule → DiscountsService and
 * IntegrationsModule → IntegrationsService actually injected),
 * which positional-construction unit tests cannot prove.
 */
describe("EC8 module graph (Storefront)", () => {
  it("resolves StorefrontService with DiscountsService + IntegrationsService injected", async () => {
    const fakePrisma: any = { auditLog: { create: jest.fn(async () => ({})) } };

    @Global()
    @Module({ providers: [{ provide: PrismaService, useValue: fakePrisma }], exports: [PrismaService] })
    class FakePrismaModule {}

    @Module({ imports: [FakePrismaModule, StorefrontModule] })
    class StorefrontGraphRootModule {}

    const ctx = await NestFactory.createApplicationContext(StorefrontGraphRootModule, { logger: false });
    try {
      const svc = ctx.get(StorefrontService);
      expect(svc).toBeInstanceOf(StorefrontService);
      expect((svc as any).discounts).toBeInstanceOf(DiscountsService);
      expect((svc as any).integrations).toBeInstanceOf(IntegrationsService);
      expect((svc as any).dnsResolver).toBeDefined();
      expect((svc as any).routingFetcher).toBeDefined();
    } finally {
      await ctx.close();
    }
  });
});
