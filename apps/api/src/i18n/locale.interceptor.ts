/**
 * ML10 (MB4) — resolves the request locale ONCE per request and
 * caches it on the request object for the exception filter.
 * Interceptors run after guards, so req.user is populated; the
 * resolver itself is failure-isolated and this interceptor never
 * blocks a request on a locale lookup.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor, Optional } from "@nestjs/common";
import { Observable } from "rxjs";
import { PrismaService } from "../prisma/prisma.service";
import { resolveRequestLocale } from "./request-locale";

@Injectable()
export class LocaleInterceptor implements NestInterceptor {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      const req = ctx.switchToHttp().getRequest();
      if (req) await resolveRequestLocale(this.prisma as any, req);
    } catch {
      /* locale resolution must never break a request */
    }
    return next.handle();
  }
}
