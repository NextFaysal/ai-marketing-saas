import { hasRoleAtLeast, canPerformAdminAction, ROLE_RANK } from "./permissions";
import { Role } from "@repo/db";

describe("permissions", () => {
  it("OWNER outranks VIEWER", () => {
    expect(hasRoleAtLeast("OWNER" as Role, "VIEWER" as Role)).toBe(true);
    expect(hasRoleAtLeast("VIEWER" as Role, "OWNER" as Role)).toBe(false);
  });
  it("MARKETING_MANAGER cannot perform admin actions", () => {
    expect(canPerformAdminAction("MARKETING_MANAGER" as Role)).toBe(false);
    expect(canPerformAdminAction("ADMIN" as Role)).toBe(true);
  });
  it("every role has a rank", () => {
    expect(Object.keys(ROLE_RANK).length).toBe(8);
  });
});
