import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "./auth-guard";
import { ApiError, apiClient } from "@/lib/api-client";
import { createQueryClient } from "@/lib/query-client";

vi.mock("@/lib/api-client", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: vi.fn(),
  };
});

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace }),
}));

describe("AuthGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to sign-in when session lookup returns 401", async () => {
    vi.mocked(apiClient).mockRejectedValue(
      new ApiError(401, { code: "UNAUTHENTICATED", message: "Authentication required" }),
    );

    renderWithQueryClient(
      <AuthGuard>
        <div>Protected content</div>
      </AuthGuard>,
    );

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/sign-in?next=%2Fdashboard");
    });
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("renders children when session lookup succeeds", async () => {
    vi.mocked(apiClient).mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
      consentedAt: "2026-06-17T00:00:00.000Z",
    });

    renderWithQueryClient(
      <AuthGuard>
        <div>Protected content</div>
      </AuthGuard>,
    );

    expect(await screen.findByText("Protected content")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = createQueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}
