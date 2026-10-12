import { describe, expect, it } from "vitest";
import {
  computeScore,
  publicLabel,
  recencyWeight,
  scoreCategory,
  type ReporterQualityMap,
  type ScorableReport,
} from "./scoring.js";

const NOW = new Date("2026-10-09T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function report(over: Partial<ScorableReport> & { reporterId: string }): ScorableReport {
  return {
    category: "fraud",
    status: "accepted",
    eventAt: NOW,
    reputationEpoch: 1,
    ...over,
  };
}

const trusted = (ids: string[]): ReporterQualityMap =>
  Object.fromEntries(ids.map((id) => [id, "reviewed_valid_history"] as const));

describe("computeScore worked example", () => {
  it.each([
    [1, 15],
    [3, 39],
    [5, 57],
    [10, 81],
    [20, 95],
  ])("E=%i -> %i", (E, expected) => {
    expect(computeScore(E)).toBe(expected);
  });

  it("returns null with no evidence", () => {
    expect(computeScore(0)).toBeNull();
  });
});

describe("recencyWeight", () => {
  it("halves every 60 days", () => {
    expect(recencyWeight(0)).toBe(1);
    expect(recencyWeight(60)).toBeCloseTo(0.5);
    expect(recencyWeight(120)).toBeCloseTo(0.25);
  });
});

describe("scoreCategory", () => {
  it("one reporter with 100 incidents contributes once", () => {
    const reports = Array.from({ length: 100 }, (_, i) =>
      report({ reporterId: "a", eventAt: daysAgo(i % 30) }),
    );
    const r = scoreCategory(reports, trusted(["a"]), "fraud", 1, NOW);
    expect(r.eligibleReporterCount).toBe(1);
    expect(r.effectiveEvidence).toBeCloseTo(1, 5);
    expect(r.score).toBe(15);
    expect(r.publicLabel).toBe("insufficient_reports");
  });

  it("spam reports never raise the fraud score", () => {
    const reports = ["a", "b", "c", "d", "e"].map((id) => report({ reporterId: id, category: "spam" }));
    const fraud = scoreCategory(reports, trusted(["a", "b", "c", "d", "e"]), "fraud", 1, NOW);
    expect(fraud.score).toBeNull();
    expect(fraud.publicLabel).toBe("insufficient_reports");
    const spam = scoreCategory(reports, trusted(["a", "b", "c", "d", "e"]), "spam", 1, NOW);
    expect(spam.score).toBe(57);
  });

  it("pending, rejected and withdrawn reports do not count", () => {
    const reports = [
      report({ reporterId: "a", status: "in_review" }),
      report({ reporterId: "b", status: "rejected" }),
      report({ reporterId: "c", status: "withdrawn" }),
      report({ reporterId: "d" }),
    ];
    const r = scoreCategory(reports, trusted(["a", "b", "c", "d"]), "fraud", 1, NOW);
    expect(r.eligibleReporterCount).toBe(1);
  });

  it("ten new verified accounts produce ~34, not 81", () => {
    const reports = Array.from({ length: 10 }, (_, i) => report({ reporterId: `n${i}` }));
    const r = scoreCategory(reports, {}, "fraud", 1, NOW);
    expect(r.effectiveEvidence).toBeCloseTo(2.5, 2);
    expect(r.score).toBe(34);
  });

  it("applies decay and the 180-day window", () => {
    const reports = [
      report({ reporterId: "a", eventAt: daysAgo(60) }),
      report({ reporterId: "b", eventAt: daysAgo(181) }),
    ];
    const r = scoreCategory(reports, trusted(["a", "b"]), "fraud", 1, NOW);
    expect(r.eligibleReporterCount).toBe(1);
    expect(r.effectiveEvidence).toBeCloseTo(0.5, 3);
  });

  it("ignores reports from a previous reputation epoch", () => {
    const reports = [report({ reporterId: "a", reputationEpoch: 1 })];
    const r = scoreCategory(reports, trusted(["a"]), "fraud", 2, NOW);
    expect(r.score).toBeNull();
  });

  it("rejects future-dated reports", () => {
    const reports = [report({ reporterId: "a", eventAt: daysAgo(-1) })];
    expect(scoreCategory(reports, trusted(["a"]), "fraud", 1, NOW).score).toBeNull();
  });

  it("caps at 95", () => {
    const reports = Array.from({ length: 50 }, (_, i) => report({ reporterId: `t${i}` }));
    const ids = reports.map((r) => r.reporterId);
    expect(scoreCategory(reports, trusted(ids), "fraud", 1, NOW).score).toBe(95);
  });

  it("coordination hold blocks the strong label but not elevated", () => {
    const reports = Array.from({ length: 12 }, (_, i) => report({ reporterId: `t${i}` }));
    const ids = reports.map((r) => r.reporterId);
    reports.push(report({ reporterId: "z", coordinationHold: true }));
    const r = scoreCategory(reports, trusted(ids), "fraud", 1, NOW);
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.coordinationHold).toBe(true);
    expect(r.publicLabel).toBe("elevated_community_risk_signal");
  });

  it("recent-window gate uses 90 days for labels while window is 180", () => {
    const reports = Array.from({ length: 5 }, (_, i) =>
      report({ reporterId: `t${i}`, eventAt: daysAgo(100) }),
    );
    const ids = reports.map((r) => r.reporterId);
    const r = scoreCategory(reports, trusted(ids), "fraud", 1, NOW);
    expect(r.eligibleReporterCount).toBe(5);
    expect(r.recentEligibleReporterCount).toBe(0);
    expect(r.publicLabel).toBe("insufficient_reports");
  });
});

describe("publicLabel gate precedence", () => {
  it("falls back to the highest satisfied label", () => {
    expect(publicLabel(85, 4, false)).toBe("some_suspicious_reports");
    expect(publicLabel(85, 6, false)).toBe("elevated_community_risk_signal");
    expect(publicLabel(85, 10, false)).toBe("strong_community_risk_signal");
    expect(publicLabel(85, 10, true)).toBe("elevated_community_risk_signal");
    expect(publicLabel(59, 100, false)).toBe("some_suspicious_reports");
    expect(publicLabel(95, 2, false)).toBe("insufficient_reports");
    expect(publicLabel(null, 0, false)).toBe("insufficient_reports");
  });
});
