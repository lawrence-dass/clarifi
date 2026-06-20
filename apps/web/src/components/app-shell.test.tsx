import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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

describe("AppShell", () => {
  it("renders wordmark and user email", () => {
    render(<AppShell><div /></AppShell>, { wrapper });
    expect(screen.getByText("Clarifi")).toBeTruthy();
    expect(screen.getByText("test@example.com")).toBeTruthy();
  });

  it("marks the active nav item in primary when pathname matches exactly", async () => {
    const { usePathname } = await import("next/navigation");
    vi.mocked(usePathname).mockReturnValue("/dashboard");

    render(<AppShell><div /></AppShell>, { wrapper });

    const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboardLink.className).toContain("text-primary");
    expect(dashboardLink.className).toContain("bg-primary");
  });

  it("does not mark Dashboard active when on a child route", async () => {
    const { usePathname } = await import("next/navigation");
    vi.mocked(usePathname).mockReturnValue("/dashboard/upload");

    render(<AppShell><div /></AppShell>, { wrapper });

    const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboardLink.className).not.toContain("text-primary");

    const uploadLink = screen.getByRole("link", { name: "Upload" });
    expect(uploadLink.className).toContain("text-primary");
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

    const uploadLink = screen.getByRole("link", { name: "Upload" });
    expect(uploadLink.className).toContain("text-text-muted");
  });

  it("renders notification bell", () => {
    render(<AppShell><div /></AppShell>, { wrapper });
    expect(screen.getByTestId("notification-bell")).toBeTruthy();
  });

  it("renders sign-out button", () => {
    render(<AppShell><div /></AppShell>, { wrapper });
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
