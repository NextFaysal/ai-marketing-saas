import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "./decorators";
import { hasRoleAtLeast } from "./permissions";
import { Role } from "@repo/db";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required?.length) return true;
    const req = ctx.switchToHttp().getRequest();
    if (req.user?.isSuperAdmin) return true;
    const role: Role | undefined = req.membership?.role;
    if (!role) throw new ForbiddenException("Organization membership required");
    if (!required.some((r) => hasRoleAtLeast(role, r as Role))) {
      throw new ForbiddenException("Insufficient role for this action");
    }
    return true;
  }
}
