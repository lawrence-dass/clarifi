import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { NotificationAnomaly } from "@/features/notifications/notification.types";
import { AnomalyInsightsSection } from "./anomaly-insights-section";

const mockUseCriticalAnomalies = vi.fn();

vi.mock("@/features/notifications/notification.hooks", () => ({
  useCriticalAnomalies: () => mockUseCriticalAnomalies(),
}));

type AnomalyOverrides = Partial<Omit<NotificationAnomaly, "transaction">> & {
  transaction?: Partial<NotificationAnomaly["transaction"]>;
};

function anomaly(overrides: AnomalyOverrides = {}): NotificationAnomaly {
  return {
    id: overrides.id ?? "a1",
    type: overrides.type ?? "merchant",
    severity: "critical",
    explanation: overrides.explanation ?? null,
    dismissed: false,
    createdAt: "2026-06-20T00:00:00.000Z",
    transaction: {
      id: "t1",
      amountCents: -12000,
      merchantName: "Test Merchant",
      category: null,
      date: "2026-06-20",
      currency: "CAD",
      ...overrides.transaction,
    },
  };
}

describe("AnomalyInsightsSection", () => {
  it("renders the critical count, preview rows, and a link to /anomalies", () => {
    mockUseCriticalAnomalies.mockReturnValue({
      data: {
        anomalies: [
          anomaly({ id: "a1", transaction: { merchantName: "Alpha" } }),
          anomaly({ id: "a2", transaction: { merchantName: "Beta" } }),
        ],
      },
      isPending: false,
      error: null,
    });

    render(<AnomalyInsightsSection />);

    expect(screen.getByText("Anomaly insights")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getAllByText("critical").length).toBeGreaterThan(0);

    const link = screen.getByRole("link", { name: /view all anomalies/i });
    expect(link.getAttribute("href")).toBe("/anomalies");
  });

  it("caps the preview at three rows even when more criticals exist", () => {
    mockUseCriticalAnomalies.mockReturnValue({
      data: {
        anomalies: Array.from({ length: 5 }, (_, i) =>
          anomaly({ id: `a${i}`, explanation: `Unusual charge ${i}` }),
        ),
      },
      isPending: false,
      error: null,
    });

    render(<AnomalyInsightsSection />);

    // count reflects all five, but only three preview rows render
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("Unusual charge 0")).toBeTruthy();
    expect(screen.getByText("Unusual charge 2")).toBeTruthy();
    expect(screen.queryByText("Unusual charge 3")).toBeNull();
  });

  it("shows a calm empty state when there are no critical anomalies", () => {
    mockUseCriticalAnomalies.mockReturnValue({
      data: { anomalies: [] },
      isPending: false,
      error: null,
    });

    render(<AnomalyInsightsSection />);

    expect(screen.getByText(/no critical anomalies/i)).toBeTruthy();
    // the page link is still offered from the empty state
    expect(screen.getByRole("link", { name: /view all anomalies/i })).toBeTruthy();
  });
});
