/**
 * ML10 (MB4, CD-1) — the coded API exception.
 *
 * Services throw `ApiException(code, params, httpStatus)` instead
 * of a bare Nest exception with a hardcoded string. The exception's
 * own `.message` is the catalog rendering in bn (the platform
 * default / source locale, ML-L6) so logs, non-HTTP callers and
 * specs that read `.message` see faithful Bengali text. The global
 * ApiI18nExceptionFilter re-renders `.message` into the request
 * locale and adds `code` + `params` to the JSON body (D-MB4-1) —
 * the web keeps reading `body.message` unchanged.
 */
import { HttpException, HttpStatus } from "@nestjs/common";
import { renderMessage } from "./render";

export type ApiExceptionParams = Record<string, unknown>;

export class ApiException extends HttpException {
  readonly code: string;
  readonly params?: ApiExceptionParams;
  /** Extra additive body fields the filter preserves (e.g. the
   * throttler's retryAfterSeconds). Set after construction. */
  extra?: Record<string, unknown>;

  constructor(code: string, params?: ApiExceptionParams | number, httpStatus: number = HttpStatus.BAD_REQUEST) {
    // Convenience overload: `new ApiException(code, 502)` treats a
    // numeric second argument as the HTTP status (no params).
    if (typeof params === "number") {
      httpStatus = params;
      params = undefined;
    }
    super(renderMessage("bn", code, params), httpStatus);
    this.code = code;
    this.params = params;
    // Nest's HttpException initMessage already sets .message from
    // the string response; assign explicitly so the contract does
    // not depend on framework internals.
    this.message = renderMessage("bn", code, params);
  }
}

/**
 * Attach a catalog pointer to an existing typed Nest exception.
 * For call sites that must keep the concrete exception class
 * (e.g. guards whose surrounding catch rethrows only
 * ForbiddenException / ServiceUnavailableException): the class and
 * the bn `.message` stay exactly as before, and the global filter
 * renders the message in the request locale from the catalog.
 */
export function withCatalogCode<T extends HttpException>(
  exception: T,
  code: string,
  params?: ApiExceptionParams,
): T {
  (exception as any).catalogCode = code;
  if (params) (exception as any).catalogParams = params;
  return exception;
}

export function badRequest(code: string, params?: ApiExceptionParams): ApiException {
  return new ApiException(code, params, HttpStatus.BAD_REQUEST);
}
export function unauthorized(code: string, params?: ApiExceptionParams): ApiException {
  return new ApiException(code, params, HttpStatus.UNAUTHORIZED);
}
export function forbidden(code: string, params?: ApiExceptionParams): ApiException {
  return new ApiException(code, params, HttpStatus.FORBIDDEN);
}
export function notFound(code: string, params?: ApiExceptionParams): ApiException {
  return new ApiException(code, params, HttpStatus.NOT_FOUND);
}
export function conflict(code: string, params?: ApiExceptionParams): ApiException {
  return new ApiException(code, params, HttpStatus.CONFLICT);
}
export function unprocessable(code: string, params?: ApiExceptionParams): ApiException {
  return new ApiException(code, params, HttpStatus.UNPROCESSABLE_ENTITY);
}
export function tooManyRequests(code: string, params?: ApiExceptionParams): ApiException {
  return new ApiException(code, params, HttpStatus.TOO_MANY_REQUESTS);
}
export function serviceUnavailable(code: string, params?: ApiExceptionParams): ApiException {
  return new ApiException(code, params, HttpStatus.SERVICE_UNAVAILABLE);
}
export function internalError(code: string, params?: ApiExceptionParams): ApiException {
  return new ApiException(code, params, HttpStatus.INTERNAL_SERVER_ERROR);
}
