import { Injectable, Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ShopAccountService } from "../storefront/shop-account.service";
import { depositFor } from "../fraud/deposit";
import { computeSlots, isValidYmd, localParts, zonedTimeToUtc } from "./slots";
import type {
  AddStaffDto, CreateBookingDto, CreateServiceDto, PublicBookDto, SetAvailabilityDto, UpdateServiceDto,
} from "./booking.dto";
import { badRequest, conflict, notFound } from "../i18n/api-exception";

/**
 * NF4 (FB2) — Service & Appointment bookings.
 *
 * V1 scope rules (deliberate, stated here so nobody has to guess):
 * - Staff are org-level: ANY active ServiceStaff can take ANY
 *   active ServiceOffering of the org (no per-staff service
 *   mapping in v1).
 * - Overlap is enforced HERE, inside a transaction: same staff,
 *   status pending|confirmed, [startAt,endAt) intersecting the
 *   new interval refuses the create. Touching boundaries
 *   (end == start) are NOT an overlap.
 * - Deposit honesty: the deposit is a QUOTE from the org's
 *   BusinessProfile deposit config (fraud/deposit depositFor,
 *   kind "manual"). A booking NEVER creates a
 *   PaymentVerification or a gateway transaction; depositState is
 *   manual-only and every response carries a Bengali depositLabel
 *   saying exactly that.
 * - Reminders ride the EXISTING ShopAccountService.sendShopSms
 *   (the installments / order-notifications path) — no parallel
 *   sender is built here.
 */

const BOOKING_STATUSES = ["pending", "confirmed", "cancelled", "completed", "no_show"] as const;
const TRANSITIONS: Record<string, string[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled", "no_show"],
  cancelled: [],
  completed: [],
  no_show: [],
};
export const BOOKING_STATUS_LABELS: Record<string, string> = {
  pending: "অপেক্ষমাণ",
  confirmed: "নিশ্চিত",
  cancelled: "বাতিল",
  completed: "সম্পন্ন",
  no_show: "আসেননি",
};

function toBigIntOrThrow(value: string | number | undefined, label: string): bigint {
  if (value === undefined || value === null || value === "") {
    throw badRequest("booking.isRequired", { label: label });
  }
  try {
    const n = typeof value === "number" ? BigInt(Math.trunc(value)) : BigInt(String(value).trim());
    return n;
  } catch {
    throw badRequest("booking.mustBeAValidNumber", { label: label });
  }
}

/** 150050 minor → "1500.50"; 150000 → "1500". Display only. */
function majorText(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const base = frac === 0n ? String(whole) : `${whole}.${String(frac).padStart(2, "0")}`;
  return neg ? `-${base}` : base;
}

export function depositLabelFor(state: string, amountMinor: bigint): string {
  if (state === "paid_manual") return "ডিপোজিট পরিশোধিত — স্টাফ ম্যানুয়ালি নিশ্চিত করেছেন (অনলাইন পেমেন্ট নয়)";
  if (state === "unpaid_manual") {
    return `ডিপোজিট বাকি ৳${majorText(amountMinor)} — এটি ম্যানুয়াল ডিপোজিট: কোনো অনলাইন পেমেন্ট নেওয়া হয়নি, দোকানে যোগাযোগ করে পরিশোধ করুন; স্টাফ পরিশোধ নিশ্চিত করলে এখানে 'পরিশোধিত' দেখাবে`;
  }
  return "ডিপোজিট প্রয়োজন নেই";
}

function pubService(s: any) {
  return {
    id: s.id,
    organizationId: s.organizationId,
    name: s.name,
    description: s.description ?? null,
    durationMinutes: s.durationMinutes,
    priceMinor: String(s.priceMinor ?? 0),
    bufferMinutes: s.bufferMinutes ?? 0,
    active: s.active !== false,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function pubStaff(s: any) {
  const user = s.membership?.user ?? null;
  return {
    id: s.id,
    organizationId: s.organizationId,
    membershipId: s.membershipId,
    displayName: s.displayName ?? null,
    memberName: user?.name ?? null,
    memberEmail: user?.email ?? null,
    active: s.active !== false,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function pubBooking(b: any) {
  const depositRequired = BigInt(b.depositRequiredMinor ?? 0);
  return {
    id: b.id,
    organizationId: b.organizationId,
    serviceId: b.serviceId,
    staffId: b.staffId,
    customerId: b.customerId ?? null,
    guestName: b.guestName,
    guestPhone: b.guestPhone,
    startAt: b.startAt instanceof Date ? b.startAt.toISOString() : b.startAt,
    endAt: b.endAt instanceof Date ? b.endAt.toISOString() : b.endAt,
    status: b.status,
    statusLabel: BOOKING_STATUS_LABELS[b.status] ?? b.status,
    source: b.source,
    depositRequiredMinor: depositRequired.toString(),
    depositState: b.depositState,
    depositLabel: depositLabelFor(b.depositState, depositRequired),
    reminderSentAt: b.reminderSentAt ?? null,
    reminderStatus: b.reminderStatus ?? null,
    note: b.note ?? null,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    ...(b.service ? { serviceName: b.service.name ?? null } : {}),
    ...(b.staff ? { staffName: b.staff.displayName ?? b.staff.membership?.user?.name ?? null } : {}),
  };
}

@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly shopAccounts?: ShopAccountService,
  ) {}

  private db(): any { return this.prisma as any; }

  private async safeAudit(input: Parameters<AuditService["log"]>[0]) {
    await this.audit?.log(input).catch(() => undefined);
  }

  private async orgTimezone(organizationId: string): Promise<string> {
    const org = await this.db().organization.findFirst({ where: { id: organizationId } });
    return String(org?.timezone ?? "").trim() || "Asia/Dhaka";
  }

  // ---------- Services ----------

  private validateServiceFields(dto: CreateServiceDto | UpdateServiceDto, partial: boolean) {
    const out: Record<string, unknown> = {};
    if (!partial || dto.name !== undefined) {
      const name = String(dto.name ?? "").trim();
      if (!name) throw badRequest("booking.theServiceNameIsRequired");
      out.name = name;
    }
    if (dto.description !== undefined) out.description = dto.description?.trim() || null;
    if (!partial || dto.durationMinutes !== undefined) {
      const d = Number(dto.durationMinutes);
      if (!Number.isInteger(d) || d < 5 || d > 1440) {
        throw badRequest("booking.theServiceDurationMustBeBetween");
      }
      out.durationMinutes = d;
    }
    if (!partial || dto.priceMinor !== undefined) {
      const price = toBigIntOrThrow(dto.priceMinor, "সার্ভিসের মূল্য");
      if (price < 0n) throw badRequest("booking.theServicePriceCannotBeNegative");
      out.priceMinor = price;
    }
    if (dto.bufferMinutes !== undefined) {
      const b = Number(dto.bufferMinutes);
      if (!Number.isInteger(b) || b < 0 || b > 240) {
        throw badRequest("booking.theBufferTimeMustBeBetween");
      }
      out.bufferMinutes = b;
    }
    if (dto.active !== undefined) out.active = dto.active === true;
    return out;
  }

  async createService(organizationId: string, actorId: string, dto: CreateServiceDto) {
    const data = this.validateServiceFields(dto ?? {}, false);
    const row = await this.db().serviceOffering.create({
      data: { organizationId, bufferMinutes: 0, active: true, ...data },
    });
    await this.safeAudit({
      organizationId, userId: actorId, action: "booking.service_create",
      entityType: "ServiceOffering", entityId: row.id, metadata: { name: row.name },
    });
    return pubService(row);
  }

  async listServices(organizationId: string, opts: { activeOnly?: boolean } = {}) {
    const rows = await this.db().serviceOffering.findMany({
      where: { organizationId, ...(opts.activeOnly ? { active: true } : {}) },
      orderBy: { createdAt: "asc" },
    });
    return (rows as any[]).map(pubService);
  }

  private async getServiceOrThrow(organizationId: string, serviceId: string) {
    const row = await this.db().serviceOffering.findFirst({ where: { id: serviceId, organizationId } });
    if (!row) throw notFound("booking.theServiceWasNotFound");
    return row;
  }

  async updateService(organizationId: string, actorId: string, serviceId: string, dto: UpdateServiceDto) {
    const existing = await this.getServiceOrThrow(organizationId, serviceId);
    const data = this.validateServiceFields(dto ?? {}, true);
    const row = await this.db().serviceOffering.update({ where: { id: existing.id }, data });
    await this.safeAudit({
      organizationId, userId: actorId, action: "booking.service_update",
      entityType: "ServiceOffering", entityId: existing.id, metadata: { fields: Object.keys(data) },
    });
    return pubService(row);
  }

  // ---------- Staff ----------

  async addStaff(organizationId: string, actorId: string, dto: AddStaffDto) {
    const membershipId = String(dto?.membershipId ?? "").trim();
    if (!membershipId) throw badRequest("booking.aMemberMembershipidIsRequired");
    const membership = await this.db().membership.findFirst({
      where: { id: membershipId, organizationId },
      include: { user: true },
    });
    if (!membership) throw badRequest("booking.theMemberDoesNotBelongTo");
    if (membership.status !== "ACTIVE") {
      throw badRequest("booking.onlyAnActiveMemberCanBe");
    }
    const existing = await this.db().serviceStaff.findFirst({
      where: { organizationId, membershipId },
      include: { membership: { include: { user: true } } },
    });
    if (existing) {
      if (existing.active === false || (dto.displayName !== undefined && dto.displayName !== existing.displayName)) {
        const row = await this.db().serviceStaff.update({
          where: { id: existing.id },
          data: { active: true, ...(dto.displayName !== undefined ? { displayName: dto.displayName?.trim() || null } : {}) },
          include: { membership: { include: { user: true } } },
        });
        return pubStaff(row);
      }
      return pubStaff(existing);
    }
    const row = await this.db().serviceStaff.create({
      data: {
        organizationId, membershipId,
        displayName: dto.displayName?.trim() || null, active: true,
      },
      include: { membership: { include: { user: true } } },
    });
    await this.safeAudit({
      organizationId, userId: actorId, action: "booking.staff_add",
      entityType: "ServiceStaff", entityId: row.id, metadata: { membershipId },
    });
    return pubStaff(row);
  }

  async listStaff(organizationId: string, opts: { activeOnly?: boolean } = {}) {
    const rows = await this.db().serviceStaff.findMany({
      where: { organizationId, ...(opts.activeOnly ? { active: true } : {}) },
      orderBy: { createdAt: "asc" },
      include: { membership: { include: { user: true } } },
    });
    return (rows as any[]).map(pubStaff);
  }

  private async getStaffOrThrow(organizationId: string, staffId: string) {
    const row = await this.db().serviceStaff.findFirst({
      where: { id: staffId, organizationId },
      include: { membership: { include: { user: true } } },
    });
    if (!row) throw notFound("booking.staffWasNotFound");
    return row;
  }

  async setStaffActive(organizationId: string, actorId: string, staffId: string, active: boolean) {
    const staff = await this.getStaffOrThrow(organizationId, staffId);
    const row = await this.db().serviceStaff.update({
      where: { id: staff.id }, data: { active: active === true },
      include: { membership: { include: { user: true } } },
    });
    await this.safeAudit({
      organizationId, userId: actorId, action: "booking.staff_active",
      entityType: "ServiceStaff", entityId: staff.id, metadata: { active: active === true },
    });
    return pubStaff(row);
  }

  // ---------- Availability ----------

  async getAvailability(organizationId: string, staffId: string) {
    const staff = await this.getStaffOrThrow(organizationId, staffId);
    const rows = await this.db().staffAvailability.findMany({
      where: { organizationId, serviceStaffId: staff.id },
      orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
    });
    return {
      staffId: staff.id,
      rows: (rows as any[]).map((r) => ({
        id: r.id, weekday: r.weekday, startMinute: r.startMinute, endMinute: r.endMinute,
      })),
    };
  }

  /** Replace-all semantics: the supplied rows ARE the staff
   * member's whole weekly availability. Fully validated BEFORE
   * any write, so a bad row never leaves a half-replaced week. */
  async setAvailability(organizationId: string, actorId: string, staffId: string, dto: SetAvailabilityDto) {
    const staff = await this.getStaffOrThrow(organizationId, staffId);
    const rows = Array.isArray(dto?.rows) ? dto.rows : [];
    const clean: Array<{ weekday: number; startMinute: number; endMinute: number }> = [];
    for (const r of rows) {
      const weekday = Number(r?.weekday);
      const startMinute = Number(r?.startMinute);
      const endMinute = Number(r?.endMinute);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        throw badRequest("booking.theDayOfTheWeekMust");
      }
      if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute)
        || startMinute < 0 || endMinute > 1440 || startMinute >= endMinute) {
        throw badRequest("booking.theTimeRangeMustBeValid");
      }
      clean.push({ weekday, startMinute, endMinute });
    }
    const sorted = [...clean].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].weekday === sorted[i - 1].weekday && sorted[i].startMinute < sorted[i - 1].endMinute) {
        throw badRequest("booking.twoTimeRangesOnTheSame");
      }
    }
    const write = async (db: any) => {
      await db.staffAvailability.deleteMany({ where: { organizationId, serviceStaffId: staff.id } });
      if (clean.length) {
        await db.staffAvailability.createMany({
          data: clean.map((r) => ({ organizationId, serviceStaffId: staff.id, ...r })),
        });
      }
      return db.staffAvailability.findMany({
        where: { organizationId, serviceStaffId: staff.id },
        orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
      });
    };
    const tx = this.db().$transaction;
    const saved = typeof tx === "function" ? await tx.call(this.db(), write) : await write(this.db());
    await this.safeAudit({
      organizationId, userId: actorId, action: "booking.availability_set",
      entityType: "ServiceStaff", entityId: staff.id, metadata: { rowCount: clean.length },
    });
    return {
      staffId: staff.id,
      rows: (saved as any[]).map((r) => ({
        id: r.id, weekday: r.weekday, startMinute: r.startMinute, endMinute: r.endMinute,
      })),
    };
  }

  // ---------- Slots ----------

  async getSlots(organizationId: string, input: { serviceId: string; staffId: string; date: string }) {
    const service = await this.getServiceOrThrow(organizationId, String(input.serviceId ?? ""));
    if (service.active === false) throw badRequest("booking.theServiceIsNotActive");
    const staff = await this.getStaffOrThrow(organizationId, String(input.staffId ?? ""));
    if (staff.active === false) throw badRequest("booking.theStaffMemberIsNotActive");
    if (!isValidYmd(input.date)) throw badRequest("booking.theDateMustBeGivenIn");
    const tz = await this.orgTimezone(organizationId);
    const availability = await this.db().staffAvailability.findMany({
      where: { organizationId, serviceStaffId: staff.id },
    });
    const dayStart = zonedTimeToUtc(tz, input.date, 0);
    const dayEnd = zonedTimeToUtc(tz, input.date, 1440);
    const bookings = await this.db().serviceBooking.findMany({
      where: {
        organizationId, staffId: staff.id,
        status: { not: "cancelled" },
        startAt: { lt: dayEnd }, endAt: { gt: dayStart },
      },
    });
    const slots = computeSlots({
      date: input.date, timezone: tz,
      availabilityRows: availability as any[],
      bookings: bookings as any[],
      durationMinutes: service.durationMinutes,
      bufferMinutes: service.bufferMinutes ?? 0,
    });
    return { serviceId: service.id, staffId: staff.id, date: input.date, timezone: tz, slots };
  }

  // ---------- Bookings ----------

  /** Guest → Customer link: CustomersService has no create
   * method, so the link lives here — find by (org, phone) and
   * reuse, else create with source "booking". */
  private async linkOrCreateCustomer(organizationId: string, phone: string, name: string) {
    const existing = await this.db().customer.findFirst({ where: { organizationId, phone } });
    if (existing) return existing;
    return this.db().customer.create({
      data: { organizationId, phone, firstName: name, source: "booking" },
    });
  }

  /**
   * The ONE booking-create path (dashboard + storefront). The
   * overlap re-check and the insert run in a single transaction;
   * a concurrent create for the same staff/slot loses with a
   * Conflict, never a double booking.
   */
  async createBooking(organizationId: string, input: {
    serviceId: string; staffId: string; startAt: Date;
    customerId?: string | null; guestName?: string; guestPhone?: string;
    note?: string | null; source: "storefront" | "dashboard"; actorId?: string | null;
  }) {
    const service = await this.getServiceOrThrow(organizationId, String(input.serviceId ?? ""));
    if (service.active === false) throw badRequest("booking.theServiceIsNotActive");
    const staff = await this.getStaffOrThrow(organizationId, String(input.staffId ?? ""));
    if (staff.active === false) throw badRequest("booking.theStaffMemberIsNotActive");
    if (!(input.startAt instanceof Date) || Number.isNaN(input.startAt.getTime())) {
      throw badRequest("booking.theBookingStartTimeMustBe");
    }
    const startAt = input.startAt;
    const endAt = new Date(startAt.getTime() + Number(service.durationMinutes) * 60_000);

    let customerId: string | null = null;
    let guestName = String(input.guestName ?? "").trim();
    let guestPhone = String(input.guestPhone ?? "").trim();
    if (input.customerId) {
      const customer = await this.db().customer.findFirst({
        where: { id: input.customerId, organizationId },
      });
      if (!customer) throw notFound("booking.theCustomerWasNotFound");
      customerId = customer.id;
      if (!guestName) guestName = [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
      if (!guestPhone) guestPhone = String(customer.phone ?? "").trim();
    } else if (guestPhone) {
      if (!guestName) throw badRequest("booking.theGuestNameIsRequired");
      const customer = await this.linkOrCreateCustomer(organizationId, guestPhone, guestName);
      customerId = customer?.id ?? null;
    }
    if (!guestName) throw badRequest("booking.theGuestNameIsRequired");
    if (!guestPhone) throw badRequest("booking.theGuestPhoneNumberIsRequired");

    // Deposit: a manual-kind QUOTE from the org's deposit config.
    // Nothing is collected here and no payment row is created.
    const profile = await this.db().businessProfile.findFirst({ where: { organizationId } });
    const quote = depositFor(profile, { totalMinor: BigInt(service.priceMinor ?? 0), kind: "manual" });
    const depositRequiredMinor = quote.active ? quote.amountMinor : 0n;
    const depositState = quote.active ? "unpaid_manual" : "not_required";

    const create = async (db: any) => {
      const clash = await db.serviceBooking.findFirst({
        where: {
          organizationId, staffId: staff.id,
          status: { in: ["pending", "confirmed"] },
          startAt: { lt: endAt }, endAt: { gt: startAt },
        },
      });
      if (clash) throw conflict("booking.theStaffMemberHasAnotherBooking");
      return db.serviceBooking.create({
        data: {
          organizationId, serviceId: service.id, staffId: staff.id,
          customerId, guestName, guestPhone, startAt, endAt,
          status: "pending", source: input.source,
          depositRequiredMinor, depositState,
          note: input.note?.trim() || null,
        },
      });
    };
    const tx = this.db().$transaction;
    const row = typeof tx === "function" ? await tx.call(this.db(), create) : await create(this.db());
    await this.safeAudit({
      organizationId, ...(input.actorId ? { userId: input.actorId } : {}),
      action: "booking.create", entityType: "ServiceBooking", entityId: row.id,
      metadata: { source: input.source, serviceId: service.id, staffId: staff.id, depositState },
    });
    return pubBooking({ ...row, service, staff });
  }

  async createBookingFromDashboard(organizationId: string, actorId: string, dto: CreateBookingDto) {
    const startAt = dto?.startAt ? new Date(dto.startAt) : new Date(NaN);
    if (Number.isNaN(startAt.getTime())) throw badRequest("booking.theBookingStartTimeStartatMust");
    return this.createBooking(organizationId, {
      serviceId: String(dto?.serviceId ?? ""), staffId: String(dto?.staffId ?? ""),
      startAt, customerId: dto?.customerId ?? null,
      guestName: dto?.guestName, guestPhone: dto?.guestPhone,
      note: dto?.note ?? null, source: "dashboard", actorId,
    });
  }

  async listBookings(organizationId: string, filters: {
    from?: string; to?: string; staffId?: string; status?: string;
  } = {}) {
    const where: Record<string, unknown> = { organizationId };
    if (filters.staffId) where.staffId = filters.staffId;
    if (filters.status) {
      if (!(BOOKING_STATUSES as readonly string[]).includes(filters.status)) {
        throw badRequest("booking.theBookingStatusIsNotValid");
      }
      where.status = filters.status;
    }
    const range: Record<string, Date> = {};
    if (filters.from) {
      const d = new Date(filters.from);
      if (Number.isNaN(d.getTime())) throw badRequest("booking.theStartDateIsNotValid");
      range.gte = d;
    }
    if (filters.to) {
      const d = new Date(filters.to);
      if (Number.isNaN(d.getTime())) throw badRequest("booking.theEndDateIsNotValid");
      range.lte = d;
    }
    if (Object.keys(range).length) where.startAt = range;
    const rows = await this.db().serviceBooking.findMany({
      where, orderBy: { startAt: "asc" },
      include: { service: true, staff: { include: { membership: { include: { user: true } } } } },
    });
    return (rows as any[]).map(pubBooking);
  }

  private async getBookingOrThrow(organizationId: string, bookingId: string) {
    const row = await this.db().serviceBooking.findFirst({
      where: { id: bookingId, organizationId },
      include: { service: true, staff: { include: { membership: { include: { user: true } } } } },
    });
    if (!row) throw notFound("booking.theBookingWasNotFound");
    return row;
  }

  async transitionBooking(organizationId: string, actorId: string, bookingId: string, target: string) {
    const booking = await this.getBookingOrThrow(organizationId, bookingId);
    const allowed = TRANSITIONS[booking.status] ?? [];
    if (!allowed.includes(target)) {
      throw badRequest("booking.theBookingCannotBeMovedFrom", { p1: BOOKING_STATUS_LABELS[booking.status] ?? booking.status, p2: BOOKING_STATUS_LABELS[target] ?? target });
    }
    const row = await this.db().serviceBooking.update({
      where: { id: booking.id }, data: { status: target },
      include: { service: true, staff: { include: { membership: { include: { user: true } } } } },
    });
    const action = target === "confirmed" ? "booking.confirm"
      : target === "cancelled" ? "booking.cancel"
        : target === "completed" ? "booking.complete" : "booking.no_show";
    await this.safeAudit({
      organizationId, userId: actorId, action,
      entityType: "ServiceBooking", entityId: booking.id,
      metadata: { from: booking.status, to: target },
    });
    return pubBooking(row);
  }

  /** Manual deposit confirmation: staff assert the guest paid
   * the quoted deposit outside the platform (cash/bKash in
   * person). This NEVER touches PaymentVerification. */
  async markDepositPaid(organizationId: string, actorId: string, bookingId: string) {
    const booking = await this.getBookingOrThrow(organizationId, bookingId);
    if (booking.depositState !== "unpaid_manual") {
      throw badRequest("booking.thisBookingHasNoRemainingManual");
    }
    const row = await this.db().serviceBooking.update({
      where: { id: booking.id }, data: { depositState: "paid_manual" },
      include: { service: true, staff: { include: { membership: { include: { user: true } } } } },
    });
    await this.safeAudit({
      organizationId, userId: actorId, action: "booking.deposit_paid",
      entityType: "ServiceBooking", entityId: booking.id,
      metadata: { depositRequiredMinor: String(booking.depositRequiredMinor ?? 0) },
    });
    return pubBooking(row);
  }

  // ---------- Public (storefront) ----------

  private async resolveOrgBySlug(orgSlug: string) {
    const org = await this.db().organization.findFirst({ where: { slug: String(orgSlug ?? "") } });
    if (!org) throw notFound("booking.theShopWasNotFound");
    return org;
  }

  /** MB4 (CD-3): the shop's storefront locale for public payloads
   * (the booking page renders its chrome in this language). */
  private async shopLocale(organizationId: string): Promise<string> {
    try {
      const s = await this.db().storefrontSetting.findFirst({
        where: { organizationId }, select: { locale: true },
      });
      return s?.locale === "en" ? "en" : "bn";
    } catch {
      return "bn";
    }
  }

  async publicServices(orgSlug: string) {
    const org = await this.resolveOrgBySlug(orgSlug);
    const services = await this.listServices(org.id, { activeOnly: true });
    const locale = await this.shopLocale(org.id);
    return { orgSlug: org.slug, orgName: org.name, locale, services };
  }

  async publicStaff(orgSlug: string) {
    const org = await this.resolveOrgBySlug(orgSlug);
    const staff = await this.listStaff(org.id, { activeOnly: true });
    const locale = await this.shopLocale(org.id);
    return {
      orgSlug: org.slug, locale,
      staff: staff.map((s) => ({ id: s.id, name: s.displayName ?? s.memberName ?? "স্টাফ" })),
    };
  }

  async publicSlots(orgSlug: string, query: { serviceId?: string; staffId?: string; date?: string }) {
    const org = await this.resolveOrgBySlug(orgSlug);
    // Slots only — never any booking details.
    const result = await this.getSlots(org.id, {
      serviceId: String(query.serviceId ?? ""), staffId: String(query.staffId ?? ""),
      date: String(query.date ?? ""),
    });
    const locale = await this.shopLocale(org.id);
    return { ...result, locale };
  }

  async publicBook(orgSlug: string, dto: PublicBookDto) {
    const org = await this.resolveOrgBySlug(orgSlug);
    const guestName = String(dto?.guestName ?? "").trim();
    if (!guestName) throw badRequest("booking.yourNameIsRequired");
    const digits = String(dto?.guestPhone ?? "").replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      throw badRequest("booking.giveAValidPhoneNumber10");
    }
    if (!isValidYmd(dto?.date)) throw badRequest("booking.theDateMustBeGivenIn");
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(String(dto?.startTime ?? ""));
    if (!timeMatch) throw badRequest("booking.giveTheTimeInHhMm");
    const minutes = Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
    if (Number(timeMatch[1]) > 23 || Number(timeMatch[2]) > 59) {
      throw badRequest("booking.theTimeMustBeValid");
    }
    const tz = String(org.timezone ?? "").trim() || "Asia/Dhaka";
    const startAt = zonedTimeToUtc(tz, dto.date as string, minutes);
    return this.createBooking(org.id, {
      serviceId: String(dto?.serviceId ?? ""), staffId: String(dto?.staffId ?? ""),
      startAt, guestName, guestPhone: String(dto?.guestPhone ?? "").trim(),
      note: dto?.note ?? null, source: "storefront", actorId: null,
    });
  }

  // ---------- Reminder sweep (service_booking_reminder_sweep) ----------

  /**
   * Confirmed bookings starting within the next 24h get ONE
   * reminder attempt each. Exactly-once stance (the
   * ScheduledReport / installments discipline): reminderSentAt
   * is stamped BEFORE the send attempt, so a failed send is
   * recorded (reminderStatus failed_no_channel | failed_error)
   * and never silently resent by a later sweep. The send itself
   * goes through ShopAccountService.sendShopSms — the org's
   * configured SMS path; with no channel configured the honest
   * outcome is failed_no_channel, never a claimed send.
   */
  async runReminderSweep(organizationId: string, now: Date = new Date()) {
    const out = { checked: 0, sent: 0, failedNoChannel: 0, failedError: 0 };
    const until = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const rows: any[] = await this.db().serviceBooking.findMany({
      where: {
        organizationId, status: "confirmed", reminderSentAt: null,
        startAt: { gte: now, lte: until },
      },
      orderBy: { startAt: "asc" },
    });
    const tz = await this.orgTimezone(organizationId);
    const org = await this.db().organization.findFirst({ where: { id: organizationId } });
    for (const booking of rows) {
      out.checked += 1;
      // Stamp FIRST — the attempt is the exactly-once unit.
      await this.db().serviceBooking.update({
        where: { id: booking.id }, data: { reminderSentAt: new Date(now) },
      });
      let status: "sent" | "failed_no_channel" | "failed_error" = "failed_no_channel";
      let reason: string | undefined = "no SMS sender configured";
      if (this.shopAccounts?.sendShopSms) {
        const service = await this.db().serviceOffering.findFirst({
          where: { id: booking.serviceId, organizationId },
        }).catch(() => null);
        const whenParts = localParts(tz, booking.startAt instanceof Date ? booking.startAt : new Date(booking.startAt));
        const hh = String(Math.floor(whenParts.minutes / 60)).padStart(2, "0");
        const mm = String(whenParts.minutes % 60).padStart(2, "0");
        const text = `রিমাইন্ডার: ${whenParts.ymd} তারিখে ${hh}:${mm}-এ আপনার "${service?.name ?? "সার্ভিস"}" বুকিং আছে${org?.name ? ` (${org.name})` : ""}। অনুগ্রহ করে সময়মতো আসুন।`;
        const send: any = await this.shopAccounts
          .sendShopSms(organizationId, booking.guestPhone, text, `booking-reminder-${booking.id}`)
          .catch((e: unknown) => ({
            sent: false, notConfigured: false,
            reason: e instanceof Error ? e.message : String(e),
          }));
        if (send?.sent) { status = "sent"; reason = undefined; }
        else if (send?.notConfigured) { status = "failed_no_channel"; reason = send.reason; }
        else { status = "failed_error"; reason = send?.reason; }
      }
      await this.db().serviceBooking.update({
        where: { id: booking.id }, data: { reminderStatus: status },
      }).catch(() => undefined);
      if (status === "sent") out.sent += 1;
      else if (status === "failed_no_channel") out.failedNoChannel += 1;
      else out.failedError += 1;
      await this.safeAudit({
        organizationId, action: "booking.reminder",
        entityType: "ServiceBooking", entityId: booking.id,
        metadata: { status, ...(reason ? { reason } : {}) },
      });
    }
    return out;
  }
}
