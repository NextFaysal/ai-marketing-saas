import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { BookingService } from "./booking.service";
import type {
  AddStaffDto, CreateBookingDto, CreateServiceDto, PublicBookDto, SetAvailabilityDto, SetStaffActiveDto, UpdateServiceDto,
} from "./booking.dto";
import { CurrentUser, AuthUser, Roles, PermissionArea, Public } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

/** NF4 (FB2) — Service & Appointment staff surface. Follows the
 * voice / live-commerce conventions: @PermissionArea("orders")
 * (appointments are an order-taking operational surface),
 * organizations/:organizationId base, TenantGuard + RolesGuard.
 * Reads: OWNER/ADMIN/MARKETING_MANAGER/SUPPORT_AGENT. Service,
 * staff and availability writes: OWNER/ADMIN only (catalogue /
 * team-shape changes); day-to-day booking handling (create,
 * confirm/cancel/complete/no-show, deposit mark-paid) is open to
 * the four working roles, like voice call handling. */
const READ_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;
const WRITE_ROLES = ["OWNER", "ADMIN"] as const;
const BOOKING_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;

@PermissionArea("orders")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class BookingController {
  constructor(private readonly booking: BookingService) {}

  // ---------- Services ----------

  @Post("booking/services") @Roles(...WRITE_ROLES)
  createService(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreateServiceDto,
  ) {
    return this.booking.createService(orgId, user.userId, dto);
  }

  @Get("booking/services") @Roles(...READ_ROLES)
  listServices(@Param("organizationId") orgId: string) {
    return this.booking.listServices(orgId);
  }

  @Patch("booking/services/:id") @Roles(...WRITE_ROLES)
  updateService(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("id") id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.booking.updateService(orgId, user.userId, id, dto);
  }

  // ---------- Staff & availability ----------

  @Post("booking/staff") @Roles(...WRITE_ROLES)
  addStaff(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: AddStaffDto,
  ) {
    return this.booking.addStaff(orgId, user.userId, dto);
  }

  @Get("booking/staff") @Roles(...READ_ROLES)
  listStaff(@Param("organizationId") orgId: string) {
    return this.booking.listStaff(orgId);
  }

  @Post("booking/staff/:staffId/active") @Roles(...WRITE_ROLES)
  setStaffActive(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("staffId") staffId: string,
    @Body() dto: SetStaffActiveDto,
  ) {
    return this.booking.setStaffActive(orgId, user.userId, staffId, dto?.active === true);
  }

  @Get("booking/staff/:staffId/availability") @Roles(...READ_ROLES)
  getAvailability(@Param("organizationId") orgId: string, @Param("staffId") staffId: string) {
    return this.booking.getAvailability(orgId, staffId);
  }

  @Put("booking/staff/:staffId/availability") @Roles(...WRITE_ROLES)
  setAvailability(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Param("staffId") staffId: string,
    @Body() dto: SetAvailabilityDto,
  ) {
    return this.booking.setAvailability(orgId, user.userId, staffId, dto);
  }

  // ---------- Slots ----------

  @Get("booking/slots") @Roles(...READ_ROLES)
  getSlots(
    @Param("organizationId") orgId: string,
    @Query("serviceId") serviceId: string,
    @Query("staffId") staffId: string,
    @Query("date") date: string,
  ) {
    return this.booking.getSlots(orgId, { serviceId, staffId, date });
  }

  // ---------- Bookings ----------

  @Post("booking/bookings") @Roles(...BOOKING_ROLES)
  createBooking(
    @CurrentUser() user: AuthUser,
    @Param("organizationId") orgId: string,
    @Body() dto: CreateBookingDto,
  ) {
    return this.booking.createBookingFromDashboard(orgId, user.userId, dto);
  }

  @Get("booking/bookings") @Roles(...READ_ROLES)
  listBookings(
    @Param("organizationId") orgId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("staffId") staffId?: string,
    @Query("status") status?: string,
  ) {
    return this.booking.listBookings(orgId, { from, to, staffId, status });
  }

  @Post("booking/bookings/:id/confirm") @Roles(...BOOKING_ROLES)
  confirm(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.booking.transitionBooking(orgId, user.userId, id, "confirmed");
  }

  @Post("booking/bookings/:id/cancel") @Roles(...BOOKING_ROLES)
  cancel(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.booking.transitionBooking(orgId, user.userId, id, "cancelled");
  }

  @Post("booking/bookings/:id/complete") @Roles(...BOOKING_ROLES)
  complete(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.booking.transitionBooking(orgId, user.userId, id, "completed");
  }

  @Post("booking/bookings/:id/no-show") @Roles(...BOOKING_ROLES)
  noShow(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.booking.transitionBooking(orgId, user.userId, id, "no_show");
  }

  @Post("booking/bookings/:id/deposit-paid") @Roles(...BOOKING_ROLES)
  depositPaid(@CurrentUser() user: AuthUser, @Param("organizationId") orgId: string, @Param("id") id: string) {
    return this.booking.markDepositPaid(orgId, user.userId, id);
  }
}

/**
 * NF4 — public storefront booking surface. SEPARATE controller
 * on "public/booking" (the "public/shop" prefix belongs to the
 * storefront controller): the org is resolved by slug, unknown
 * slug → 404. Responses expose services, staff display names and
 * FREE SLOTS only — never other customers' booking details.
 */
@Controller("public/booking")
export class BookingPublicController {
  constructor(private readonly booking: BookingService) {}

  @Public()
  @Get(":orgSlug/services")
  services(@Param("orgSlug") orgSlug: string) {
    return this.booking.publicServices(orgSlug);
  }

  @Public()
  @Get(":orgSlug/staff")
  staff(@Param("orgSlug") orgSlug: string) {
    return this.booking.publicStaff(orgSlug);
  }

  @Public()
  @Get(":orgSlug/slots")
  slots(
    @Param("orgSlug") orgSlug: string,
    @Query("serviceId") serviceId?: string,
    @Query("staffId") staffId?: string,
    @Query("date") date?: string,
  ) {
    return this.booking.publicSlots(orgSlug, { serviceId, staffId, date });
  }

  @Public()
  @Post(":orgSlug/book")
  book(@Param("orgSlug") orgSlug: string, @Body() dto: PublicBookDto) {
    return this.booking.publicBook(orgSlug, dto);
  }
}
