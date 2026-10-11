import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSION_AREA_KEY, ROLES_KEY } from "./decorators";
import { hasRoleAtLeast } from "./permissions";
import { normalizeOverrides } from "./permission-catalog";
import { Role } from "@repo/db";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    if (req.user?.isSuperAdmin) return true;
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    const role: Role | undefined = req.membership?.role;

    // Milestone 72 (Team W3): custom access on tagged endpoints.
    // A DENY closes the area for the member outright — even on
    // endpoints with no @Roles at all (e.g. the inbox list,
    // which any member may open by default). Overrides never
    // apply to the OWNER.
    const area = this.reflector.getAllAndOverride<string>(PERMISSION_AREA_KEY, [ctx.getHandler(), ctx.getClass()]);
    const overrides = area && role && role !== "OWNER"
      ? normalizeOverrides(req.membership?.permissionOverrides)
      : null;
    if (area && overrides?.denies.includes(area)) {
      throw new ForbiddenException("This area has been closed for your account by a custom access rule");
    }

    if (!required?.length) return true;
    if (!role) throw new ForbiddenException("Organization membership required");
    const rolePass = required.some((r) => hasRoleAtLeast(role, r as Role));
    if (rolePass) return true;

    // A GRANT admits below-role — except owner-only gates
    // (@Roles("OWNER") exactly), which are never grantable.
    // Untagged endpoints keep pure role behavior.
    const ownerOnlyGate = required.length === 1 && required[0] === "OWNER";
    if (area && overrides && !ownerOnlyGate && overrides.grants.includes(area)) return true;
    throw new ForbiddenException("Insufficient role for this action");
  }
}
