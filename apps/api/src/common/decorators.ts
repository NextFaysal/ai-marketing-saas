import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = "roles";
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/** Milestone 72: tag a controller or handler with a custom-access
 * permission area (see common/permission-catalog.ts). RolesGuard
 * consults the member's grants/denies for tagged endpoints. */
export const PERMISSION_AREA_KEY = "permissionArea";
export const PermissionArea = (area: string) => SetMetadata(PERMISSION_AREA_KEY, area);

export interface AuthUser { userId: string; email: string; isSuperAdmin: boolean }

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
