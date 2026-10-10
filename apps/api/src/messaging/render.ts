/** {{variable}} substitution from real context data only. Unknown
 *  variables render as empty strings - nothing is ever invented. */
export function renderTemplate(body: string, vars: Record<string, unknown>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

export interface WorkflowCondition { field: string; op: string; value: unknown }

/** All conditions must pass. Fields resolve from the event context. */
export function evaluateConditions(context: Record<string, any>, conditions: WorkflowCondition[] | null | undefined): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((c) => {
    const actual = context[c.field];
    const expected = c.value;
    switch (c.op) {
      case "eq": return String(actual) === String(expected);
      case "neq": return String(actual) !== String(expected);
      case "gt": return Number(actual) > Number(expected);
      case "gte": return Number(actual) >= Number(expected);
      case "lt": return Number(actual) < Number(expected);
      case "lte": return Number(actual) <= Number(expected);
      case "contains": return String(actual ?? "").includes(String(expected));
      default: return false;
    }
  });
}
