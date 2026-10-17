import "reflect-metadata";
import { HrService, proRataDeduction, overlapDays } from "./hr.service";

/**
 * NF11 (FB4) — HR lite specs. Fake-prisma harness in the
 * nf10-accounting.spec pattern (in-memory tables, org-scoped
 * `matches`, real unique enforcement on the keys the design
 * rides). Accounting is a recording fake standing in for
 * NF10's AccountingService public door (listAccounts +
 * createJournalEntry) — the real door's own balance invariant
 * is spec-proven in nf10-accounting.spec.
 */

type Row = Record<string, any>;

function cmp(a: any, b: any): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub));
    if (k === "AND") return (v as any[]).every((sub) => matches(row, sub));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.map(String).includes(String(row[k]));
      if ("notIn" in v) return !(v as any).notIn.map(String).includes(String(row[k]));
      if ("not" in v) return row[k] !== (v as any).not;
      if ("lt" in v) return cmp(row[k], (v as any).lt) < 0;
      if ("lte" in v) return cmp(row[k], (v as any).lte) <= 0;
      if ("gt" in v) return cmp(row[k], (v as any).gt) > 0;
      if ("gte" in v) return cmp(row[k], (v as any).gte) >= 0;
      return true;
    }
    if (v instanceof Date) return row[k] instanceof Date && row[k].getTime() === v.getTime();
    return String(row[k]) === String(v);
  });
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  const specs = (Array.isArray(orderBy) ? orderBy : [orderBy]).filter(Boolean);
  if (!specs.length) return rows;
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const [key, dir] = Object.entries(spec)[0] as [string, string];
      const c = cmp(a[key], b[key]);
      if (c !== 0) return dir === "desc" ? -c : c;
    }
    return 0;
  });
}

let seq = 0;
function makeTable(rows: Row[], uniqueKeys: string[][] = []) {
  return {
    rows,
    async findFirst({ where }: any = {}) {
      return rows.find((r) => matches(r, where)) ?? null;
    },
    async findMany({ where, orderBy, take, skip }: any = {}) {
      let out = rows.filter((r) => matches(r, where));
      out = sortRows(out, orderBy);
      if (skip) out = out.slice(skip);
      if (take) out = out.slice(0, take);
      return out;
    },
    async create({ data }: any) {
      for (const keys of uniqueKeys) {
        if (keys.some((k) => data[k] === null || data[k] === undefined)) continue;
        if (rows.some((r) => keys.every((k) => String(r[k]) === String(data[k])))) {
          throw new Error("Unique constraint failed on the fields: P2002");
        }
      }
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    async update({ where, data }: any) {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("record not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    async deleteMany({ where }: any = {}) {
      let n = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) { rows.splice(i, 1); n++; }
      return { count: n };
    },
    async delete({ where }: any) {
      const i = rows.findIndex((r) => r.id === where.id);
      if (i < 0) throw new Error("record not found");
      rows.splice(i, 1);
      return {};
    },
  };
}

const ORG = "org-1";
const ORG2 = "org-2";

function member(id: string, userId: string, name: string, status = "ACTIVE", orgId = ORG) {
  return {
    id, organizationId: orgId, userId, role: "SUPPORT_AGENT", status,
    user: { id: userId, name, email: `${userId}@example.com` },
  };
}

function makeWorld() {
  const tables = {
    organization: makeTable([
      { id: ORG, name: "Org One", timezone: "Asia/Dhaka" },
      { id: ORG2, name: "Org Two", timezone: "Asia/Dhaka" },
    ]),
    membership: makeTable([
      member("m-a", "u-a", "Ayesha"),
      member("m-b", "u-b", "Bilal"),
      member("m-c", "u-c", "Chitra"),
      member("m-d", "u-d", "Dipu", "SUSPENDED"),
      member("m-e", "u-e", "Esha"),
      member("m-x", "u-x", "X-org member", "ACTIVE", ORG2),
    ]),
    hrSetting: makeTable([], [["organizationId"]]),
    staffSalaryProfile: makeTable([], [["membershipId"]]),
    attendanceRecord: makeTable([], [["organizationId", "membershipId", "date"]]),
    staffShiftPattern: makeTable([]),
    leaveRequest: makeTable([]),
    payrollRun: makeTable([], [["organizationId", "year", "month"]]),
    payrollLine: makeTable([], [["runId", "membershipId"]]),
    order: makeTable([]),
  };
  const audit = { logs: [] as any[], async log(input: any) { this.logs.push(input); } };
  const journalCalls: any[] = [];
  const accounting = {
    async listAccounts(_orgId: string) {
      return { items: [
        { id: "acc-salary", code: "5210", name: "Expense: Salary", systemKey: "expense_salary" },
        { id: "acc-cash", code: "1000", name: "Cash", systemKey: "cash" },
      ] };
    },
    async createJournalEntry(orgId: string, actorId: string | undefined, input: any) {
      journalCalls.push({ orgId, actorId, input });
      return { entry: { id: "je-payroll-1" }, lines: [], created: true };
    },
  };
  const svc = new HrService(tables as any, audit as any, accounting as any);
  return { tables, audit, accounting, journalCalls, svc };
}

async function seedLeave(tables: any, membershipId: string, from: string, to: string, paid: string, status: string) {
  const days = overlapDays(from, to, from, to);
  return tables.leaveRequest.create({
    data: { organizationId: ORG, membershipId, fromDate: from, toDate: to, days, paid, status, reason: "test" },
  });
}

function seedOrder(tables: any, agentId: string | null, status: string, placedAt: string, commissionMinor: bigint) {
  return tables.order.create({
    data: { organizationId: ORG, agentId, status, placedAt: new Date(placedAt), createdAt: new Date(placedAt), commissionMinor, totalMinor: 100000n },
  });
}

describe("NF11 HR lite", () => {
  it("pro-rata math: per_calendar_day, round-half-up, caps at days-in-month", () => {
    expect(proRataDeduction(3100000n, 3, 31)).toBe(300000n);
    expect(proRataDeduction(2800000n, 2, 28)).toBe(200000n);
    expect(proRataDeduction(100001n, 1, 30)).toBe(3333n); // 3333.36… → 3333
    expect(proRataDeduction(100005n, 1, 10)).toBe(10001n); // 10000.5 → 10001 (half up)
    expect(proRataDeduction(500000n, 0, 30)).toBe(0n);
    expect(proRataDeduction(500000n, 45, 30)).toBe(500000n); // capped
    expect(overlapDays("2026-01-30", "2026-02-02", "2026-02-01", "2026-02-28")).toBe(2);
    expect(overlapDays("2026-01-30", "2026-02-02", "2026-01-01", "2026-01-31")).toBe(2);
    expect(overlapDays("2026-03-01", "2026-03-05", "2026-02-01", "2026-02-28")).toBe(0);
  });

  it("setting: defaults are the explicit stored rules; unknown rule values are refused", async () => {
    const { svc } = makeWorld();
    const s = await svc.getSetting(ORG);
    expect(s.unpaidLeaveRule).toBe("per_calendar_day");
    expect(s.commissionRule).toBe("recorded_order_commission");
    await expect(svc.updateSetting(ORG, "u-owner", { unpaidLeaveRule: "per_working_day" })).rejects.toThrow();
    await expect(svc.updateSetting(ORG, "u-owner", { commissionRule: "percent_of_sales" })).rejects.toThrow();
  });

  it("salary profile: admin sets it, the member sees their own summary, foreign membership refused", async () => {
    const { svc } = makeWorld();
    const { profile } = await svc.setSalaryProfile(ORG, "u-owner", "m-a", {
      baseSalaryMinor: "3100000", effectiveFrom: "2026-09-01", payoutNote: "bKash personal",
    });
    expect(profile!.baseSalaryMinor).toBe("3100000");
    expect(profile!.effectiveFrom).toBe("2026-09-01");
    const mine = await svc.mySalaryProfile(ORG, "u-a");
    expect(mine.profile?.baseSalaryMinor).toBe("3100000");
    const other = await svc.mySalaryProfile(ORG, "u-b");
    expect(other.profile).toBeNull();
    await expect(svc.setSalaryProfile(ORG, "u-owner", "m-x", { baseSalaryMinor: "100", effectiveFrom: "2026-09-01" })).rejects.toThrow();
    await expect(svc.setSalaryProfile(ORG, "u-owner", "m-a", { baseSalaryMinor: "0", effectiveFrom: "2026-09-01" })).rejects.toThrow();
  });

  it("attendance: self check-in/out is once-per-day and strictly one's own record", async () => {
    const { svc, tables } = makeWorld();
    const { record } = await svc.checkIn(ORG, "u-a");
    expect(record.checkInAt).toBeTruthy();
    expect(record.source).toBe("self");
    await expect(svc.checkIn(ORG, "u-a")).rejects.toThrow();
    const out = await svc.checkOut(ORG, "u-a");
    expect(out.record.checkOutAt).toBeTruthy();
    await expect(svc.checkOut(ORG, "u-a")).rejects.toThrow();
    await expect(svc.checkOut(ORG, "u-b")).rejects.toThrow(); // never checked in
    const bIn = await svc.checkIn(ORG, "u-b");
    expect(bIn.record.membershipId).toBe("m-b");
    expect(tables.attendanceRecord.rows).toHaveLength(2);
    const mine = await svc.myAttendance(ORG, "u-a");
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0].membershipId).toBe("m-a");
  });

  it("attendance correction: note is required and an AuditLog entry is ALWAYS written", async () => {
    const { svc, audit } = makeWorld();
    await expect(svc.correctAttendance(ORG, "u-admin", {
      membershipId: "m-a", date: "2026-10-03", checkInAt: "2026-10-03T03:00:00Z", correctionNote: "",
    })).rejects.toThrow();
    const { record } = await svc.correctAttendance(ORG, "u-admin", {
      membershipId: "m-a", date: "2026-10-03",
      checkInAt: "2026-10-03T03:00:00Z", checkOutAt: "2026-10-03T11:00:00Z",
      correctionNote: "কার্ড রিডার বন্ধ ছিল",
    });
    expect(record.source).toBe("staff_correction");
    expect(record.correctionNote).toBe("কার্ড রিডার বন্ধ ছিল");
    const entry = audit.logs.find((l) => l.action === "hr.attendance_corrected");
    expect(entry).toBeTruthy();
    expect(entry.entityType).toBe("AttendanceRecord");
    expect(entry.metadata.correctionNote).toBe("কার্ড রিডার বন্ধ ছিল");
  });

  it("shift roster: NF4-shaped validation (weekday 0-6, minutes, end > start), replace-all", async () => {
    const { svc } = makeWorld();
    await expect(svc.setShiftPatterns(ORG, "u-admin", "m-a", {
      patterns: [{ weekday: 7, startMinute: 540, endMinute: 1020 }],
    })).rejects.toThrow();
    await expect(svc.setShiftPatterns(ORG, "u-admin", "m-a", {
      patterns: [{ weekday: 1, startMinute: 1020, endMinute: 540 }],
    })).rejects.toThrow();
    const { items } = await svc.setShiftPatterns(ORG, "u-admin", "m-a", {
      patterns: [
        { weekday: 0, startMinute: 540, endMinute: 1020 },
        { weekday: 1, startMinute: 540, endMinute: 1020 },
      ],
    });
    expect(items).toHaveLength(2);
    const mine = await svc.myShiftPatterns(ORG, "u-a");
    expect(mine.items).toHaveLength(2);
    const replaced = await svc.setShiftPatterns(ORG, "u-admin", "m-a", { patterns: [{ weekday: 2, startMinute: 600, endMinute: 900 }] });
    expect(replaced.items).toHaveLength(1);
  });

  it("leave: inclusive day count, state machine — a decided request can never be re-decided", async () => {
    const { svc } = makeWorld();
    const { leave } = await svc.createLeave(ORG, "u-a", { fromDate: "2026-10-10", toDate: "2026-10-12", paid: "unpaid", reason: "পারিবারিক" });
    expect(leave.days).toBe(3);
    expect(leave.status).toBe("pending");
    const decided = await svc.decideLeave(ORG, "u-admin", leave.id, "approved");
    expect(decided.leave.status).toBe("approved");
    expect(decided.leave.decidedBy).toBe("u-admin");
    await expect(svc.decideLeave(ORG, "u-admin", leave.id, "rejected")).rejects.toThrow();
    await expect(svc.decideLeave(ORG, "u-admin", leave.id, "approved")).rejects.toThrow();
    const { leave: l2 } = await svc.createLeave(ORG, "u-a", { fromDate: "2026-11-01", toDate: "2026-11-01", paid: "paid" });
    const rejected = await svc.decideLeave(ORG, "u-admin", l2.id, "rejected");
    expect(rejected.leave.status).toBe("rejected");
    await expect(svc.createLeave(ORG, "u-a", { fromDate: "2026-11-05", toDate: "2026-11-01", paid: "paid" })).rejects.toThrow();
  });

  it("payroll: deduction ONLY from approved unpaid leave; commission ONLY from recorded Order.commissionMinor on attributed sold orders", async () => {
    const { svc, tables } = makeWorld();
    await svc.setSalaryProfile(ORG, "u-owner", "m-a", { baseSalaryMinor: "3100000", effectiveFrom: "2026-09-01" });
    await svc.setSalaryProfile(ORG, "u-owner", "m-e", { baseSalaryMinor: "2000000", effectiveFrom: "2026-09-01" });
    await svc.setSalaryProfile(ORG, "u-owner", "m-c", { baseSalaryMinor: "9000000", effectiveFrom: "2026-11-01" }); // not yet effective
    await svc.setSalaryProfile(ORG, "u-owner", "m-d", { baseSalaryMinor: "9000000", effectiveFrom: "2026-09-01" }); // SUSPENDED member
    // A: 3 approved-unpaid days in Oct; paid/pending/rejected must deduct NOTHING
    await seedLeave(tables, "m-a", "2026-10-10", "2026-10-12", "unpaid", "approved");
    await seedLeave(tables, "m-a", "2026-10-15", "2026-10-16", "paid", "approved");
    await seedLeave(tables, "m-a", "2026-10-20", "2026-10-24", "unpaid", "pending");
    await seedLeave(tables, "m-a", "2026-10-25", "2026-10-28", "unpaid", "rejected");
    // A orders: recorded commission on sold + in-month only
    await seedOrder(tables, "u-a", "delivered", "2026-10-05T10:00:00+06:00", 15000n);
    await seedOrder(tables, "u-a", "completed", "2026-10-20T10:00:00+06:00", 0n);
    await seedOrder(tables, "u-a", "processing", "2026-10-06T10:00:00+06:00", 99999n); // not sold
    await seedOrder(tables, "u-a", "delivered", "2026-09-30T10:00:00+06:00", 777n); // other month
    await seedOrder(tables, "u-b", "delivered", "2026-10-07T10:00:00+06:00", 555n); // someone else's
    // E: real sales activity, ZERO recorded commission → commission must stay 0 (no ৳50-per-delivery invention)
    await seedOrder(tables, "u-e", "delivered", "2026-10-08T10:00:00+06:00", 0n);
    await seedOrder(tables, "u-e", "delivered", "2026-10-09T10:00:00+06:00", 0n);

    const { run } = await svc.generateRun(ORG, "u-owner", { year: 2026, month: 10 });
    expect(run.status).toBe("draft");
    expect(run.lines).toHaveLength(2); // A + E only (B no profile, C not effective, D suspended)
    const lineA = run.lines!.find((l: any) => l.membershipId === "m-a");
    expect(lineA.unpaidLeaveDays).toBe(3);
    expect(lineA.deductionMinor).toBe("300000"); // 3,100,000 × 3 ÷ 31
    expect(lineA.commissionMinor).toBe("15000");
    expect(lineA.totalMinor).toBe("2815000");
    const lineE = run.lines!.find((l: any) => l.membershipId === "m-e");
    expect(lineE.commissionMinor).toBe("0");
    expect(lineE.totalMinor).toBe("2000000");
    expect(run.totalMinor).toBe("4815000");
    expect(run.ruleSnapshot.unpaidLeaveRule).toBe("per_calendar_day");
    expect(run.ruleSnapshot.commissionRule).toBe("recorded_order_commission");
    expect(run.ruleSnapshot.daysInMonth).toBe(31);
    const inputA = run.ruleSnapshot.inputs.find((i: any) => i.membershipId === "m-a");
    expect(inputA.attributedSoldOrders).toBe(2);
    expect(inputA.unpaidLeaveRequestIds).toHaveLength(1);
  });

  it("payroll: leave overlapping the month boundary counts only the in-month days", async () => {
    const { svc, tables } = makeWorld();
    await svc.setSalaryProfile(ORG, "u-owner", "m-a", { baseSalaryMinor: "2800000", effectiveFrom: "2026-01-01" });
    await seedLeave(tables, "m-a", "2026-01-30", "2026-02-02", "unpaid", "approved");
    const { run } = await svc.generateRun(ORG, "u-owner", { year: 2026, month: 2 });
    const line = run.lines![0];
    expect(line.unpaidLeaveDays).toBe(2);
    expect(line.deductionMinor).toBe("200000"); // 2,800,000 × 2 ÷ 28
  });

  it("payroll: regenerating a DRAFT replaces its lines; adjustments need label + note and move the totals", async () => {
    const { svc, tables } = makeWorld();
    await svc.setSalaryProfile(ORG, "u-owner", "m-a", { baseSalaryMinor: "3100000", effectiveFrom: "2026-09-01" });
    const first = await svc.generateRun(ORG, "u-owner", { year: 2026, month: 10 });
    expect(first.run.lines![0].deductionMinor).toBe("0");
    await seedLeave(tables, "m-a", "2026-10-10", "2026-10-12", "unpaid", "approved");
    const second = await svc.generateRun(ORG, "u-owner", { year: 2026, month: 10 });
    expect(second.run.id).toBe(first.run.id);
    expect(second.run.lines).toHaveLength(1);
    expect(second.run.lines![0].deductionMinor).toBe("300000");
    expect(tables.payrollLine.rows).toHaveLength(1);

    await expect(svc.updateLineAdjustments(ORG, "u-admin", second.run.id, second.run.lines![0].id, {
      adjustments: [{ label: "বোনাস", amountMinor: "50000", note: "" }],
    })).rejects.toThrow();
    const { line, runTotalMinor } = await svc.updateLineAdjustments(ORG, "u-admin", second.run.id, second.run.lines![0].id, {
      adjustments: [
        { label: "ঈদ বোনাস", amountMinor: "50000", note: "উৎসব বোনাস" },
        { label: "কমিশন (ম্যানুয়াল)", amountMinor: 25000, note: "অফলাইন বিক্রির কমিশন, রসিদ #12" },
      ],
    });
    expect(line.totalMinor).toBe("2875000"); // 3,100,000 − 300,000 + 0 + 50,000 + 25,000
    expect(runTotalMinor).toBe("2875000");
  });

  it("payroll: mark-paid is a draft→paid RECORD, posts ONE balanced NF10 journal entry, and a paid run is immutable", async () => {
    const { svc, journalCalls } = makeWorld();
    await svc.setSalaryProfile(ORG, "u-owner", "m-a", { baseSalaryMinor: "3100000", effectiveFrom: "2026-09-01" });
    const { run } = await svc.generateRun(ORG, "u-owner", { year: 2026, month: 10 });
    const result = await svc.markPaid(ORG, "u-owner", run.id);
    expect(result.run.status).toBe("paid");
    expect(result.run.paidBy).toBe("u-owner");
    expect(result.run.paidAt).toBeTruthy();
    expect(result.journalPosted).toBe(true);
    expect(result.journalEntryId).toBe("je-payroll-1");
    expect(journalCalls).toHaveLength(1);
    const call = journalCalls[0];
    expect(call.input.sourceType).toBe("payroll_run");
    expect(call.input.sourceId).toBe(run.id);
    const dr = call.input.lines.reduce((s: bigint, l: any) => s + BigInt(l.debitMinor), 0n);
    const cr = call.input.lines.reduce((s: bigint, l: any) => s + BigInt(l.creditMinor), 0n);
    expect(dr).toBe(3100000n);
    expect(dr).toBe(cr);
    expect(call.input.lines[0].accountId).toBe("acc-salary");
    expect(call.input.lines[1].accountId).toBe("acc-cash");
    // immutability
    await expect(svc.markPaid(ORG, "u-owner", run.id)).rejects.toThrow();
    await expect(svc.generateRun(ORG, "u-owner", { year: 2026, month: 10 })).rejects.toThrow();
    await expect(svc.updateLineAdjustments(ORG, "u-admin", run.id, run.lines![0].id, { adjustments: [] })).rejects.toThrow();
    expect(journalCalls).toHaveLength(1); // never double-posted
  });

  it("payslip: totals equal the stored line total and the run total; staff see ONLY their own; PDF builds from the line", async () => {
    const { svc } = makeWorld();
    await svc.setSalaryProfile(ORG, "u-owner", "m-a", { baseSalaryMinor: "3100000", effectiveFrom: "2026-09-01" });
    await svc.setSalaryProfile(ORG, "u-owner", "m-e", { baseSalaryMinor: "2000000", effectiveFrom: "2026-09-01" });
    const { run } = await svc.generateRun(ORG, "u-owner", { year: 2026, month: 10 });
    const lineA = run.lines!.find((l: any) => l.membershipId === "m-a");
    const slip = await svc.payslipData(ORG, lineA.id, { userId: "u-a", admin: false });
    expect(slip.line.totalMinor).toBe(lineA.totalMinor);
    const sum = run.lines!.reduce((s: bigint, l: any) => s + BigInt(l.totalMinor), 0n);
    expect(sum.toString()).toBe(run.totalMinor);
    await expect(svc.payslipData(ORG, lineA.id, { userId: "u-e", admin: false })).rejects.toThrow();
    const adminSlip = await svc.payslipData(ORG, lineA.id, { userId: "u-admin", admin: true });
    expect(adminSlip.member.membershipId).toBe("m-a");
    const pdf = await svc.buildPayslipPdf(ORG, lineA.id, { userId: "u-a", admin: false });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1")).toContain("TOTAL PAYABLE");
    const mine = await svc.myPayslips(ORG, "u-e");
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0].membershipId).toBe("m-e");
  });

  it("org isolation: another org's staff, profiles and payslips are invisible", async () => {
    const { svc } = makeWorld();
    await svc.setSalaryProfile(ORG, "u-owner", "m-a", { baseSalaryMinor: "3100000", effectiveFrom: "2026-09-01" });
    const staff2 = await svc.listStaff(ORG2);
    expect(staff2.items.map((i: any) => i.membershipId)).toEqual(["m-x"]);
    expect(staff2.items[0].salaryProfile).toBeNull();
    const { run } = await svc.generateRun(ORG2, "u-owner", { year: 2026, month: 10 });
    expect(run.lines).toHaveLength(0);
    const { run: run1 } = await svc.generateRun(ORG, "u-owner", { year: 2026, month: 10 });
    await expect(svc.payslipData(ORG2, run1.lines![0].id, { userId: "u-x", admin: true })).rejects.toThrow();
    await expect(svc.mySalaryProfile(ORG2, "u-a")).rejects.toThrow();
  });
});
