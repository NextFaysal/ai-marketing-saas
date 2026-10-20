import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { MerchantApiService } from "./merchant-api.service";
import { PrismaService } from "../prisma/prisma.service";
import { assertWithinApiDailyLimit, incrementApiUsage } from "../common/api-usage";
import { forbidden, unauthorized } from "../i18n/api-exception";

export interface MerchantApiContext {
  orgId: string;
  keyId: string;
  scopes: string[];
  createdById: string;
}

/**
 * Throw a 403 naming the missing scope when the authenticated
 * merchant key does not carry it. Used by every data route.
 */
export function requireScope(req: any, scope: string): void {
  const scopes: string[] = Array.isArray(req?.merchantApi?.scopes) ? req.merchantApi.scopes : [];
  if (!scopes.includes(scope)) {
    throw forbidden("merchantApi.thisKeyDoesNotHaveThe", { scope: scope });
  }
}

/**
 * AB8 (AX21): authentication for the /v1/merchant surface.
 * Accepts `Authorization: Bearer <token>` or the
 * `x-merchant-api-key` header. The org is derived from the KEY
 * (req.merchantApi) — never from a client-supplied org id.
 * Order of operations on success: the plan's apiDailyLimit is
 * asserted BEFORE the handler runs (429 on a known breach),
 * then the daily counter is incremented fire-and-forget
 * (fully failure-isolated inside incrementApiUsage).
 */
@Injectable()
export class MerchantApiKeyGuard implements CanActivate {
  constructor(
    private readonly keys: MerchantApiService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const headers = req?.headers ?? {};
    let token: string | undefined;
    const authHeader = headers["authorization"];
    if (typeof authHeader === "string" && /^Bearer\s+/i.test(authHeader)) {
      token = authHeader.replace(/^Bearer\s+/i, "").trim();
    }
    if (!token && typeof headers["x-merchant-api-key"] === "string") {
      token = headers["x-merchant-api-key"].trim();
    }
    if (!token) {
      throw unauthorized("merchantApi.merchantApiKeyRequiredAuthorizationBearer");
    }
    const auth = await this.keys.authenticate(token);
    if (!auth) throw unauthorized("merchantApi.invalidOrRevokedMerchantApiKey");

    await assertWithinApiDailyLimit(this.prisma as any, auth.organizationId);
    void incrementApiUsage(this.prisma as any, auth.organizationId);

    req.merchantApi = {
      orgId: auth.organizationId,
      keyId: auth.keyId,
      scopes: auth.scopes,
      createdById: auth.createdById,
    } satisfies MerchantApiContext;
    return true;
  }
}
