import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import { createQueryClient } from "@/lib/query-client";

const mockReplace = vi.fn();
const mockMutateAsync = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: vi.fn(() => "/dashboard"),
}));

vi.mock("@/lib/auth", () => ({
  useSession: () => ({ data: { email: "test@example.com" } }),
  useLogout: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

vi.mock("@/features/notifications/notification-bell", () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>;
}

const DESTINATIONS = ["Dashboard", "Query", "Anomalies", "Consents"];

describe("AppShell", () => {
  it("renders the wordmark", () => {
    render(<AppShell><div /></AppShell>, { wrapper });
    expect(screen.getByText("Clarifi")).toBeTruthy();
  });

  it("renders exactly the four destination nav links", () => {
    render(<AppShell><div /></AppShell>, { wrapper });
    for (const label of DESTINATIONS) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
  });

  it("does not expose Upload, Budgets, or Account as nav links", () => {
    render(<AppShell><div /></AppShell>, { wrapper });
    expect(screen.queryByRole("link", { name: "Upload" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Budgets" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Account" })).toBeNull();
  });

  it("marks the active nav item in primary when pathname matches exactly", async () => {
    const { usePathname } = await import("next/navigation");
    vi.mocked(usePathname).mockReturnValue("/dashboard");

    render(<AppShell><div /></AppShell>, { wrapper });

    const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboardLink.className).toContain("text-primary");
    expect(dashboardLink.className).toContain("bg-primary");
  });

  it("marks Query active on its child route without double-highlighting Dashboard", async () => {
    const { usePathname } = await import("next/navigation");
    vi.mocked(usePathname).mockReturnValue("/dashboard/query");

    render(<AppShell><div /></AppShell>, { wrapper });

    const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboardLink.className).not.toContain("text-primary");

    const queryLink = screen.getByRole("link", { name: "Query" });
    expect(queryLink.className).toContain("text-primary");
  });

  it("marks Consents active when on /consents", async () => {
    const { usePathname } = await import("next/navigation");
    vi.mocked(usePathname).mockReturnValue("/consents");

    render(<AppShell><div /></AppShell>, { wrapper });

    const consentsLink = screen.getByRole("link", { name: "Consents" });
    expect(consentsLink.className).toContain("text-primary");
  });

  it("inactive nav items carry text-muted class", async () => {
    const { usePathname } = await import("next/navigation");
    vi.mocked(usePathname).mockReturnValue("/dashboard");

    render(<AppShell><div /></AppShell>, { wrapper });

    const anomaliesLink = screen.getByRole("link", { name: "Anomalies" });
    expect(anomaliesLink.className).toContain("text-text-muted");
  });

  it("renders notification bell", () => {
    render(<AppShell><div /></AppShell>, { wrapper });
    expect(screen.getByTestId("notification-bell")).toBeTruthy();
  });

  it("opens the upload modal from the '+ Add data' action", () => {
    render(<AppShell><div /></AppShell>, { wrapper });

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /add data/i }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    // UploadPanel content is rendered inside the modal
    expect(screen.getByLabelText(/csv file/i)).toBeTruthy();
  });

  it("exposes the email and a sign-out control via the account menu", () => {
    render(<AppShell><div /></AppShell>, { wrapper });

    expect(screen.queryByText("test@example.com")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));

    expect(screen.getByText("test@example.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeTruthy();
  });

  it("renders children in main", () => {
    render(
      <AppShell><div data-testid="child-content">content</div></AppShell>,
      { wrapper },
    );
    expect(screen.getByTestId("child-content")).toBeTruthy();
  });
});
