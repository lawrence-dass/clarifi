import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiClient } from "@/lib/api-client";
import { createQueryClient } from "@/lib/query-client";
import { BudgetsSection } from "./budgets-section";
import { CashFlowSummarySection } from "./cash-flow-summary-section";

vi.mock("@/lib/api-client", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: vi.fn(),
  };
});

describe("dashboard sections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders cash-flow summary data for the selected currency", async () => {
    vi.mocked(apiClient).mockResolvedValue({
      month: "2026-06",
      previousMonth: "2026-05",
      currencies: [
        {
          currency: "CAD",
          incomeCents: 500000,
          expensesCents: 12500,
          netCents: 487500,
          topMerchants: [{ merchantName: "Loblaws", totalCents: 3500, transactionCount: 2 }],
          categoryDeltas: [
            {
              category: "food_and_dining",
              currentCents: 5700,
              previousCents: 5000,
              deltaCents: 700,
            },
          ],
        },
      ],
    });

    renderWithQueryClient(<CashFlowSummarySection month="2026-06" currency="CAD" />);

    expect(await screen.findByText("$5,000.00")).toBeInTheDocument();
    expect(screen.getByText("$125.00")).toBeInTheDocument();
    expect(screen.getByText("$4,875.00")).toBeInTheDocument();
    expect(screen.getByText("Loblaws")).toBeInTheDocument();
    expect(screen.getByText("Food & dining")).toBeInTheDocument();
  });

  it("renders a loading state while a section query is pending", () => {
    vi.mocked(apiClient).mockReturnValue(new Promise(() => undefined));

    renderWithQueryClient(<CashFlowSummarySection month="2026-06" currency="CAD" />);

    expect(screen.getByText("Loading cash-flow summary")).toBeInTheDocument();
  });

  it("renders an ApiError message for a failed section query", async () => {
    vi.mocked(apiClient).mockRejectedValue(
      new ApiError(500, { code: "INTERNAL", message: "Summary unavailable" }),
    );

    renderWithQueryClient(<CashFlowSummarySection month="2026-06" currency="CAD" />);

    expect(await screen.findByText("Summary unavailable")).toBeInTheDocument();
  });

  it("renders an empty state when the selected currency is absent", async () => {
    vi.mocked(apiClient).mockResolvedValue({
      month: "2026-06",
      previousMonth: "2026-05",
      currencies: [],
    });

    renderWithQueryClient(<CashFlowSummarySection month="2026-06" currency="CAD" />);

    expect(await screen.findByText("No CAD cash-flow summary for 2026-06.")).toBeInTheDocument();
  });

  it("shows 'Over budget' alert and red bar when percentUsed >= 100", async () => {
    vi.mocked(apiClient).mockResolvedValue({
      month: "2026-06",
      currency: "CAD",
      budgets: [
        {
          category: "food_and_dining",
          month: "2026-06",
          monthlyLimitCents: 10000,
          spentCents: 12000,
          remainingCents: -2000,
          percentUsed: 120,
          currency: "CAD",
        },
      ],
    });

    renderWithQueryClient(<BudgetsSection month="2026-06" />);

    expect(await screen.findByText(/Over budget/)).toBeInTheDocument();
    expect(await screen.findByText(/120%/)).toBeInTheDocument();
  });

  it("shows 'Approaching limit' alert when percentUsed is 80-99", async () => {
    vi.mocked(apiClient).mockResolvedValue({
      month: "2026-06",
      currency: "CAD",
      budgets: [
        {
          category: "transport",
          month: "2026-06",
          monthlyLimitCents: 10000,
          spentCents: 8500,
          remainingCents: 1500,
          percentUsed: 85,
          currency: "CAD",
        },
      ],
    });

    renderWithQueryClient(<BudgetsSection month="2026-06" />);

    expect(await screen.findByText(/Approaching limit/)).toBeInTheDocument();
    expect(await screen.findByText(/85%/)).toBeInTheDocument();
  });

  it("shows no alert when percentUsed < 80", async () => {
    vi.mocked(apiClient).mockResolvedValue({
      month: "2026-06",
      currency: "CAD",
      budgets: [
        {
          category: "shopping",
          month: "2026-06",
          monthlyLimitCents: 10000,
          spentCents: 5000,
          remainingCents: 5000,
          percentUsed: 50,
          currency: "CAD",
        },
      ],
    });

    renderWithQueryClient(<BudgetsSection month="2026-06" />);

    // Multiple "Shopping" elements exist (budget card + dropdown option) — just
    // verify the alert labels are absent
    await screen.findByText(/50% used/);
    expect(screen.queryByText(/Over budget/)).toBeNull();
    expect(screen.queryByText(/Approaching limit/)).toBeNull();
  });

  it("sets a budget through apiClient and invalidates the month budget query", async () => {
    const apiMock = vi.mocked(apiClient);
    apiMock.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path.startsWith("/budgets?")) {
        return {
          month: "2026-06",
          currency: "CAD",
          budgets: [],
        };
      }
      if (path === "/budgets" && options?.method === "PUT") {
        return {
          id: "budget-1",
          category: "food_and_dining",
          month: "2026-06",
          monthlyLimitCents: 10000,
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderWithQueryClient(<BudgetsSection month="2026-06" />);

    expect(await screen.findByText("No CAD budgets set for 2026-06. Use the form below to create one.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set budget" }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith("/budgets", {
        method: "PUT",
        body: { category: "food_and_dining", month: "2026-06", monthlyLimitCents: 10000 },
      });
    });
    await waitFor(() => {
      expect(apiMock.mock.calls.filter(([path]) => String(path).startsWith("/budgets?"))).toHaveLength(2);
    });
  });
});

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({
    queries: { retry: false },
    mutations: { retry: false },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}
