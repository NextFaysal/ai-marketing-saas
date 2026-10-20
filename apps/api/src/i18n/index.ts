/**
 * ML10 (MB4) — API i18n public surface.
 *
 * W-2 / W-3 import from here (or the direct module paths):
 *   import { ApiException, badRequest, notFound, renderMessage } from "../i18n";
 * (adjust the relative prefix to the importing file's depth).
 */
export { MESSAGE_CATALOG, type CatalogEntry, type CatalogNamespace } from "./catalog";
export {
  renderMessage,
  normalizeApiLocale,
  hasCatalogCode,
  catalogEntry,
  placeholdersOf,
  API_LOCALES,
  DEFAULT_API_LOCALE,
  type ApiLocale,
} from "./render";
export {
  ApiException,
  withCatalogCode,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  unprocessable,
  tooManyRequests,
  serviceUnavailable,
  internalError,
  type ApiExceptionParams,
} from "./api-exception";
export {
  resolveRequestLocale,
  syncRequestLocale,
  isPublicRoute,
  REQUEST_LOCALE_KEY,
} from "./request-locale";
export { ApiI18nExceptionFilter, codedShapeOf } from "./api-exception.filter";
export { LocaleInterceptor } from "./locale.interceptor";
export { validationExceptionFactory, CodedValidationException } from "./validation";
