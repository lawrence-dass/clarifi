import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiClient } from "@/lib/api-client";
import { createQueryClient } from "@/lib/query-client";
import { QueryChat } from "./query-chat";

vi.mock("@/lib/api-client", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: vi.fn() };
});

function renderChat() {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <QueryChat />
    </QueryClientProvider>,
  );
}

async function ask(question: string) {
  fireEvent.change(screen.getByPlaceholderText("Ask about your spending…"), {
    target: { value: question },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
}

describe("QueryChat result rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a money metric value formatted as dollars (not raw cents, not —)", async () => {
    // Regression: the metric column is aliased `value` by the SQL compiler, and
    // money metrics are integer cents — must format to $ at the display layer.
    vi.mocked(apiClient).mockResolvedValue({
      interpretation: "Total spend in June 2026.",
      rows: [{ value: 120050 }],
      metric: "total_spend",
      dimensions: [],
    });

    renderChat();
    await ask("How much did I spend?");

    expect(await screen.findByText("$1,200.50")).toBeInTheDocument();
    expect(screen.queryByText("120,050")).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("renders a count metric as a plain number, not currency", async () => {
    vi.mocked(apiClient).mockResolvedValue({
      interpretation: "Number of transactions in June 2026.",
      rows: [{ value: 42 }],
      metric: "transaction_count",
      dimensions: [],
    });

    renderChat();
    await ask("How many transactions did I make?");

    expect(await screen.findByText("42")).toBeInTheDocument();
    expect(screen.queryByText("$42.00")).not.toBeInTheDocument();
  });

  it("renders a grouped table with dimension labels and formatted money values", async () => {
    vi.mocked(apiClient).mockResolvedValue({
      interpretation: "Spend by category in June 2026.",
      rows: [
        { category: "food_and_dining", value: 50000 },
        { category: "transport", value: 12345 },
      ],
      metric: "total_spend",
      dimensions: ["category"],
    });

    renderChat();
    await ask("What did I spend by category?");

    expect(await screen.findByText("food_and_dining")).toBeInTheDocument();
    expect(screen.getByText("$500.00")).toBeInTheDocument();
    expect(screen.getByText("$123.45")).toBeInTheDocument();
  });

  it("surfaces an error turn when the query fails", async () => {
    vi.mocked(apiClient).mockRejectedValue(
      new ApiError(400, { code: "UNPROCESSABLE", message: "could not interpret question" }),
    );

    renderChat();
    await ask("gibberish question");

    expect(await screen.findByText(/could not interpret question/i)).toBeInTheDocument();
  });
});
