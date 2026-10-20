/**
 * ML10 (MB4, D-MB4-1) — global exception filter.
 *
 * For an ApiException — and for any HttpException whose response
 * carries a `code` that exists in the catalog — the body keeps the
 * existing `{ statusCode, message }` shape and ADDS `code` +
 * `params` (+ `details` for coded validation errors); `message`
 * is rendered in the REQUEST locale (cached on the request by the
 * LocaleInterceptor; guard-thrown errors fall back synchronously
 * to bn / an attached user preference).
 *
 * Plain HttpExceptions without a catalog code pass through with
 * Nest's default behaviour untouched — including exceptions whose
 * response object carries extra fields, which are preserved.
 *
 * Nest does NOT await async exception filters, so this filter is
 * deliberately synchronous; all DB-backed locale work happens in
 * the interceptor.
 */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { ApiException } from "./api-exception";
import { hasCatalogCode, renderMessage } from "./render";
import { syncRequestLocale } from "./request-locale";

interface CodedShape {
  code: string;
  /** Code rendered from (may differ from `code` for legacy wire codes). */
  renderCode: string;
  params?: Record<string, unknown>;
  details?: unknown;
  extra: Record<string, unknown>;
}

/**
 * Pre-catalog wire codes thrown as `{ code, message }` response
 * objects by the guards (GB9/ORG11). The wire `code` value is a
 * contract the web may match on, so it is preserved verbatim in
 * the body; only the message is re-rendered from the catalog.
 */
export const LEGACY_CODE_ALIASES: Record<string, string> = {
  EMAIL_VERIFICATION_REQUIRED: "auth.emailVerificationRequired",
  ORG_MFA_REQUIRED: "common.orgMfaRequired",
  ORG_SESSION_EXPIRED: "common.orgSessionExpired",
};

export function codedShapeOf(exception: unknown): CodedShape | null {
  if (exception instanceof ApiException) {
    return {
      code: exception.code,
      renderCode: exception.code,
      params: exception.params,
      details: (exception as any).details,
      extra: ((exception as any).extra as Record<string, unknown>) ?? {},
    };
  }
  if (exception instanceof HttpException) {
    // Exceptions carrying an explicit catalog pointer (e.g.
    // OrderLimitBlockedError's staff message) render from it.
    const pointed = (exception as any).catalogCode;
    if (hasCatalogCode(pointed)) {
      return {
        code: pointed,
        renderCode: pointed,
        params: (exception as any).catalogParams,
        details: (exception as any).details,
        extra: {},
      };
    }
    const direct = (exception as any).code;
    if (hasCatalogCode(direct)) {
      return { code: direct, renderCode: direct, params: (exception as any).params, details: (exception as any).details, extra: {} };
    }
    const res = exception.getResponse();
    if (res && typeof res === "object") {
      const { code, params, message: _m, statusCode: _s, error: _e, ...rest } = res as Record<string, unknown>;
      // Preserve the original `error` label additively.
      if (_e !== undefined) rest.error = _e;
      if (hasCatalogCode(code)) {
        return {
          code: code as string,
          renderCode: code as string,
          params: params as Record<string, unknown> | undefined,
          details: (res as Record<string, unknown>).details,
          extra: rest,
        };
      }
      if (typeof code === "string" && hasCatalogCode(LEGACY_CODE_ALIASES[code])) {
        return {
          code,
          renderCode: LEGACY_CODE_ALIASES[code],
          params: params as Record<string, unknown> | undefined,
          details: (res as Record<string, unknown>).details,
          extra: rest,
        };
      }
    }
  }
  return null;
}

@Catch(HttpException)
export class ApiI18nExceptionFilter extends BaseExceptionFilter implements ExceptionFilter {
  override catch(exception: HttpException, host: ArgumentsHost): void {
    const coded = codedShapeOf(exception);
    if (!coded) {
      super.catch(exception, host);
      return;
    }
    const ctx = host.switchToHttp();
    const req = ctx.getRequest();
    const res = ctx.getResponse();
    const locale = syncRequestLocale(req ?? {});
    const status = exception.getStatus();
    const body: Record<string, unknown> = {
      ...coded.extra,
      statusCode: status,
      message: renderMessage(locale, coded.renderCode, coded.params),
      code: coded.code,
    };
    if (coded.params && Object.keys(coded.params).length > 0) body.params = coded.params;
    if (coded.details !== undefined) body.details = coded.details;
    if (res && typeof res.status === "function") {
      // Express-style response (the app's adapter): status()
      // returns the response itself, which carries .json().
      // Guard against double-send the way BaseExceptionFilter
      // does.
      const headersSent = (res as any).headersSent === true;
      if (!headersSent) {
        const chained = res.status(status);
        const target = chained && typeof chained.json === "function" ? chained : res;
        if (typeof target.json === "function") target.json(body);
        else super.catch(exception, host);
      }
    } else {
      super.catch(exception, host);
    }
  }
}
