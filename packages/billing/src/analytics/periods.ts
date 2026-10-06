/**
 * Billing period segmentation, matching `resolvePeriod` in accounts.ts: an
 * instant belongs to the subscription period that contains it, otherwise
 * to its UTC calendar month. Calendar months are clipped around
 * subscription periods so no instant belongs to two periods.
 */

export interface Period {
  start: Date;
  end: Date;
  source: "subscription" | "calendar";
}

const monthStart = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
const nextMonth = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));

/** Periods overlapping [from, to), in order. */
export function segmentPeriods(
  subscriptionPeriods: Array<{ start: Date; end: Date }>,
  from: Date,
  to: Date,
): Period[] {
  // A later period (e.g. after an upgrade) cuts short the one before it.
  const sorted = [...subscriptionPeriods]
    .filter((period) => period.end > period.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const subscriptions: Period[] = [];
  for (const [index, period] of sorted.entries()) {
    const next = sorted[index + 1];
    const end = next && next.start < period.end ? next.start : period.end;
    if (end > period.start)
      subscriptions.push({ start: period.start, end, source: "subscription" });
  }

  const periods: Period[] = [];
  let cursor = from;
  while (cursor < to) {
    const subscription = subscriptions.find(
      (period) => period.start <= cursor && cursor < period.end,
    );
    if (subscription) {
      periods.push(subscription);
      cursor = subscription.end;
      continue;
    }
    const nextSubscription = subscriptions.find((period) => period.start > cursor);
    let end = nextMonth(cursor);
    if (nextSubscription && nextSubscription.start < end) end = nextSubscription.start;
    // Calendar periods start at the month boundary unless a subscription ended mid-month.
    const endedThisMonth = subscriptions
      .map((period) => period.end)
      .filter((ended) => ended <= cursor && ended >= monthStart(cursor));
    const start = endedThisMonth.length
      ? new Date(Math.max(...endedThisMonth.map((ended) => ended.getTime())))
      : monthStart(cursor);
    periods.push({ start, end, source: "calendar" });
    cursor = end;
  }
  return periods;
}

/** Seconds of [start, stop) inside [from, to). */
export function overlapSeconds(start: Date, stop: Date, from: Date, to: Date): number {
  const ms = Math.min(stop.getTime(), to.getTime()) - Math.max(start.getTime(), from.getTime());
  return Math.max(0, ms / 1000);
}
