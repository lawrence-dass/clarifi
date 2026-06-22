"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "@/features/account/user-menu";
import { NotificationBell } from "@/features/notifications/notification-bell";
import { AddDataButton } from "@/features/upload/add-data-button";
import { useSession } from "@/lib/auth";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/query", label: "Query" },
  { href: "/anomalies", label: "Anomalies" },
  { href: "/consents", label: "Consents" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const session = useSession();

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-border bg-surface shadow-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <Link href="/dashboard" className="text-lg font-semibold text-text">
                Clarifi
              </Link>
              {session.data?.isDemo ? (
                <span
                  className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
                  title="You are exploring a temporary demo with synthetic data."
                >
                  {session.data.demoKind === "csv"
                    ? "CSV Demo"
                    : session.data.demoKind === "plaid"
                      ? "Plaid Demo"
                      : "Demo"}
                </span>
              ) : null}
            </div>
            <nav className="flex flex-wrap items-center gap-1 text-sm">
              {navItems.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={
                      active
                        ? "rounded px-3 py-2 font-medium text-primary bg-primary/10"
                        : "rounded px-3 py-2 text-text-muted hover:bg-canvas hover:text-text"
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <AddDataButton />
            <NotificationBell />
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
