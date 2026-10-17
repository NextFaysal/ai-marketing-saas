/**
 * NF4 (FB2) — Service & Appointment DTOs (plain interfaces, the
 * voice.types.ts pattern): every merchant-readable validation
 * lives in BookingService so failures are Bengali 400s, not bare
 * validation lists. priceMinor accepts string | number (BigInt
 * boundary) and is stored as BigInt.
 */

export interface CreateServiceDto {
  name?: string;
  description?: string | null;
  durationMinutes?: number;
  priceMinor?: string | number;
  bufferMinutes?: number;
  active?: boolean;
}

export interface UpdateServiceDto {
  name?: string;
  description?: string | null;
  durationMinutes?: number;
  priceMinor?: string | number;
  bufferMinutes?: number;
  active?: boolean;
}

export interface AddStaffDto {
  membershipId?: string;
  displayName?: string | null;
}

export interface SetStaffActiveDto {
  active?: boolean;
}

export interface AvailabilityRowDto {
  weekday?: number;
  startMinute?: number;
  endMinute?: number;
}

export interface SetAvailabilityDto {
  rows?: AvailabilityRowDto[];
}

export interface CreateBookingDto {
  serviceId?: string;
  staffId?: string;
  /** ISO instant of the appointment start. */
  startAt?: string;
  customerId?: string | null;
  guestName?: string;
  guestPhone?: string;
  note?: string | null;
}

export interface PublicBookDto {
  serviceId?: string;
  staffId?: string;
  /** Org-local calendar date "YYYY-MM-DD". */
  date?: string;
  /** Org-local start time "HH:mm". */
  startTime?: string;
  guestName?: string;
  guestPhone?: string;
  note?: string | null;
}
