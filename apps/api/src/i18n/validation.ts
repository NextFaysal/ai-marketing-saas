/**
 * ML10 (MB4, D-MB4-4) — ValidationPipe exceptionFactory.
 *
 * Without this, DTO validation errors stay framework-English
 * forever (DTO custom messages are only a handful). Each class-
 * validator failure becomes a catalog-coded error: the headline
 * `message` is rendered by the global filter from the FIRST
 * constraint's generic catalog key (`validation.<constraint>`),
 * while the full default message list is preserved as `details`
 * (Nest's default shape carries `message` as a string[] — web
 * reads only `body.message`, so the array moves to `details`
 * additively and `message` becomes a rendered string).
 *
 * A constraint whose text is a DTO-authored custom message in
 * Bengali (e.g. the @Matches messages in orders.dto) is carried
 * verbatim via the `validation.custom` key — merchant/platform
 * authored wording is never silently reworded.
 */
import type { ValidationError } from "class-validator";
import { ApiException } from "./api-exception";
import { hasCatalogCode } from "./render";

export class CodedValidationException extends ApiException {
  readonly details: string[];
  constructor(code: string, params: Record<string, unknown> | undefined, details: string[]) {
    super(code, params, 400);
    this.details = details;
  }
}

interface FlatConstraint {
  property: string;
  constraint: string;
  text: string;
}

function flatten(errors: ValidationError[], prefix = ""): FlatConstraint[] {
  const out: FlatConstraint[] = [];
  for (const err of errors ?? []) {
    const property = prefix ? `${prefix}.${err.property}` : err.property;
    for (const [constraint, text] of Object.entries(err.constraints ?? {})) {
      out.push({ property, constraint, text: String(text) });
    }
    if (err.children?.length) out.push(...flatten(err.children, property));
  }
  return out;
}

const BENGALI_RE = /[\u0980-\u09FF]/; // Bengali Unicode block

/** Numeric bound embedded in class-validator's default texts. */
function limitOf(constraint: string, text: string): number | undefined {
  if (!/^(minLength|maxLength|length|min|max|arrayMinSize|arrayMaxSize)$/.test(constraint)) return undefined;
  const m = /(-?\d+(?:\.\d+)?)/.exec(text);
  return m ? Number(m[1]) : undefined;
}

export function validationExceptionFactory(errors: ValidationError[]): CodedValidationException {
  const flat = flatten(errors);
  const details = flat.map((f) => f.text);
  const first = flat[0];
  if (!first) {
    return new CodedValidationException("validation.invalid", undefined, details);
  }
  if (BENGALI_RE.test(first.text)) {
    return new CodedValidationException("validation.custom", { message: first.text }, details);
  }
  const key = `validation.${first.constraint}`;
  const code = hasCatalogCode(key) ? key : "validation.invalid";
  const params: Record<string, unknown> = { property: first.property };
  const limit = limitOf(first.constraint, first.text);
  if (limit !== undefined) params.limit = limit;
  return new CodedValidationException(code, params, details);
}
