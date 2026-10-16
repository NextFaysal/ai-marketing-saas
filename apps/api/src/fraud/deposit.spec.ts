import { depositFor, depositConfigOf, DEFAULT_DEPOSIT_NOTE } from "./deposit";

/**
 * AB4 (AX5a) — deposit rule helper: pure evaluation over the
 * BusinessProfile deposit fields. Pinned: OFF discipline
 * (invalid config never guesses), percent floor, fixed cap at
 * the total, the appliesTo coverage matrix, and the note
 * default/custom behaviour.
 */

const PCT20 = { depositMode: "percent", depositPercent: 20, depositAppliesTo: "all" };

describe("AB4 depositFor — OFF discipline", () => {
  it("no profile / null mode / unknown mode → OFF", () => {
    expect(depositFor(null, { totalMinor: 10000n, kind: "cod" }).active).toBe(false);
    expect(depositFor(undefined, { totalMinor: 10000n, kind: "cod" }).active).toBe(false);
    expect(depositFor({}, { totalMinor: 10000n, kind: "cod" })).toEqual({
      active: false, mode: null, amountMinor: 0n, note: null,
    });
    expect(depositFor({ depositMode: "half" }, { totalMinor: 10000n, kind: "cod" }).active).toBe(false);
  });

  it("total ≤ 0 → OFF", () => {
    expect(depositFor(PCT20, { totalMinor: 0n, kind: "cod" }).active).toBe(false);
    expect(depositFor(PCT20, { totalMinor: -500n, kind: "cod" }).active).toBe(false);
  });

  it("percent out of range / non-integer → OFF (never guessed)", () => {
    for (const pct of [0, 91, 100, -5, 20.5, Number.NaN]) {
      expect(
        depositFor({ depositMode: "percent", depositPercent: pct, depositAppliesTo: "all" },
          { totalMinor: 10000n, kind: "cod" }).active,
      ).toBe(false);
    }
    expect(
      depositFor({ depositMode: "percent", depositPercent: null, depositAppliesTo: "all" },
        { totalMinor: 10000n, kind: "cod" }).active,
    ).toBe(false);
  });

  it("fixed ≤ 0 / missing → OFF", () => {
    expect(depositFor({ depositMode: "fixed", depositFixedMinor: 0n, depositAppliesTo: "all" },
      { totalMinor: 10000n, kind: "cod" }).active).toBe(false);
    expect(depositFor({ depositMode: "fixed", depositFixedMinor: null, depositAppliesTo: "all" },
      { totalMinor: 10000n, kind: "cod" }).active).toBe(false);
  });

  it("percent whose floor is 0 → OFF for that order", () => {
    // 1% of 50 minor units floors to 0 — nothing meaningful to collect.
    expect(depositFor({ depositMode: "percent", depositPercent: 1, depositAppliesTo: "all" },
      { totalMinor: 50n, kind: "cod" }).active).toBe(false);
  });
});

describe("AB4 depositFor — amounts", () => {
  it("percent is floored (BigInt division)", () => {
    const q = depositFor(PCT20, { totalMinor: 9999n, kind: "cod" });
    expect(q.active).toBe(true);
    expect(q.mode).toBe("percent");
    expect(q.amountMinor).toBe(1999n); // floor(9999 × 20 / 100)
  });

  it("percent 90 boundary is allowed", () => {
    const q = depositFor({ depositMode: "percent", depositPercent: 90, depositAppliesTo: "all" },
      { totalMinor: 10000n, kind: "online" });
    expect(q.amountMinor).toBe(9000n);
  });

  it("fixed amount is capped at the order total", () => {
    const q = depositFor({ depositMode: "fixed", depositFixedMinor: 50000n, depositAppliesTo: "all" },
      { totalMinor: 30000n, kind: "cod" });
    expect(q.active).toBe(true);
    expect(q.mode).toBe("fixed");
    expect(q.amountMinor).toBe(30000n);
  });

  it("fixed accepts string / number minor values", () => {
    expect(depositFor({ depositMode: "fixed", depositFixedMinor: "2500", depositAppliesTo: "all" },
      { totalMinor: 10000n, kind: "manual" }).amountMinor).toBe(2500n);
    expect(depositFor({ depositMode: "fixed", depositFixedMinor: 2500, depositAppliesTo: "all" },
      { totalMinor: 10000n, kind: "manual" }).amountMinor).toBe(2500n);
  });
});

describe("AB4 depositFor — appliesTo matrix", () => {
  const kinds = ["cod", "online", "manual"] as const;
  it('"cod" covers COD only (and is the default for unknown values)', () => {
    for (const kind of kinds) {
      expect(depositFor({ ...PCT20, depositAppliesTo: "cod" }, { totalMinor: 10000n, kind }).active)
        .toBe(kind === "cod");
      expect(depositFor({ depositMode: "percent", depositPercent: 20 }, { totalMinor: 10000n, kind }).active)
        .toBe(kind === "cod");
    }
  });

  it('"online" covers gateway-paid only', () => {
    for (const kind of kinds) {
      expect(depositFor({ ...PCT20, depositAppliesTo: "online" }, { totalMinor: 10000n, kind }).active)
        .toBe(kind === "online");
    }
  });

  it('"all" covers every kind', () => {
    for (const kind of kinds) {
      expect(depositFor({ ...PCT20, depositAppliesTo: "all" }, { totalMinor: 10000n, kind }).active).toBe(true);
    }
  });
});

describe("AB4 depositFor — note", () => {
  it("default note when none / blank is configured", () => {
    expect(depositFor(PCT20, { totalMinor: 10000n, kind: "cod" }).note).toBe(DEFAULT_DEPOSIT_NOTE);
    expect(depositFor({ ...PCT20, depositNote: "   " }, { totalMinor: 10000n, kind: "cod" }).note)
      .toBe(DEFAULT_DEPOSIT_NOTE);
  });

  it("custom note wins (trimmed)", () => {
    expect(depositFor({ ...PCT20, depositNote: "  আগে ২০০ টাকা পাঠান  " },
      { totalMinor: 10000n, kind: "cod" }).note).toBe("আগে ২০০ টাকা পাঠান");
  });
});

describe("AB4 depositConfigOf — settings serialization", () => {
  it("empty profile → nulls with the safe appliesTo default", () => {
    expect(depositConfigOf(null)).toEqual({
      mode: null, percent: null, fixedMinor: null, appliesTo: "cod", note: null,
    });
    expect(depositConfigOf({ depositMode: "bogus" }).mode).toBeNull();
  });

  it("valid profile serializes money as a decimal string", () => {
    expect(depositConfigOf({
      depositMode: "fixed", depositPercent: 25, depositFixedMinor: 12345n,
      depositAppliesTo: "online", depositNote: "নোট",
    })).toEqual({
      mode: "fixed", percent: 25, fixedMinor: "12345", appliesTo: "online", note: "নোট",
    });
  });

  it("unknown appliesTo falls back to cod; non-finite percent reads null", () => {
    const out = depositConfigOf({ depositMode: "percent", depositPercent: "abc", depositAppliesTo: "everywhere" });
    expect(out.appliesTo).toBe("cod");
    expect(out.percent).toBeNull();
  });
});
