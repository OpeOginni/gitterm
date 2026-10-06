import { describe, expect, test } from "bun:test";
import { overlapSeconds, segmentPeriods } from "./periods";

const d = (iso: string) => new Date(iso);

describe("segmentPeriods", () => {
  test("uses calendar months without a subscription", () => {
    expect(segmentPeriods([], d("2026-01-15T00:00:00Z"), d("2026-03-01T00:00:00Z"))).toEqual([
      { start: d("2026-01-01T00:00:00Z"), end: d("2026-02-01T00:00:00Z"), source: "calendar" },
      { start: d("2026-02-01T00:00:00Z"), end: d("2026-03-01T00:00:00Z"), source: "calendar" },
    ]);
  });

  test("clips calendar months around a subscription that starts and ends mid-month", () => {
    const periods = segmentPeriods(
      [{ start: d("2026-01-10T00:00:00Z"), end: d("2026-02-10T00:00:00Z") }],
      d("2026-01-01T00:00:00Z"),
      d("2026-03-01T00:00:00Z"),
    );
    expect(periods.map((period) => [period.start.toISOString(), period.source])).toEqual([
      ["2026-01-01T00:00:00.000Z", "calendar"],
      ["2026-01-10T00:00:00.000Z", "subscription"],
      ["2026-02-10T00:00:00.000Z", "calendar"],
    ]);
    expect(periods[0]!.end).toEqual(d("2026-01-10T00:00:00Z"));
    expect(periods[2]!.end).toEqual(d("2026-03-01T00:00:00Z"));
  });

  test("starts a calendar period at a subscription end before the window", () => {
    const [first] = segmentPeriods(
      [{ start: d("2026-01-01T00:00:00Z"), end: d("2026-02-10T00:00:00Z") }],
      d("2026-02-20T00:00:00Z"),
      d("2026-02-21T00:00:00Z"),
    );
    expect(first).toEqual({
      start: d("2026-02-10T00:00:00Z"),
      end: d("2026-03-01T00:00:00Z"),
      source: "calendar",
    });
  });

  test("a later subscription period cuts short an overlapping earlier one", () => {
    const periods = segmentPeriods(
      [
        { start: d("2026-01-01T00:00:00Z"), end: d("2026-02-01T00:00:00Z") },
        { start: d("2026-01-15T00:00:00Z"), end: d("2026-02-15T00:00:00Z") },
      ],
      d("2026-01-01T00:00:00Z"),
      d("2026-02-15T00:00:00Z"),
    );
    expect(periods.map((period) => [period.start.toISOString(), period.end.toISOString()])).toEqual(
      [
        ["2026-01-01T00:00:00.000Z", "2026-01-15T00:00:00.000Z"],
        ["2026-01-15T00:00:00.000Z", "2026-02-15T00:00:00.000Z"],
      ],
    );
  });
});

describe("overlapSeconds", () => {
  test("counts only the part inside the window", () => {
    expect(
      overlapSeconds(
        d("2026-01-31T23:00:00Z"),
        d("2026-02-01T01:00:00Z"),
        d("2026-02-01T00:00:00Z"),
        d("2026-03-01T00:00:00Z"),
      ),
    ).toBe(3600);
  });
});
