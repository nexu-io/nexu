import { describe, expect, it } from "vitest";
import { getSeedancePromoCountdown } from "./seedance-promo";

describe("getSeedancePromoCountdown", () => {
  it("starts each cycle at two days remaining", () => {
    const cycleStart = new Date("2026-04-01T00:00:00+08:00");
    const now = cycleStart.getTime();

    expect(getSeedancePromoCountdown(now, cycleStart)).toMatchObject({
      days: 1,
      hours: 23,
      minutes: 59,
    });
  });

  it("loops back after two days", () => {
    const cycleStart = new Date("2026-04-01T00:00:00+08:00");
    const now = new Date("2026-04-03T01:30:00+08:00").getTime();

    expect(getSeedancePromoCountdown(now, cycleStart)).toMatchObject({
      days: 1,
      hours: 22,
      minutes: 30,
    });
  });
});
