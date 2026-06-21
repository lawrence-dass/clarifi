"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "@/features/account/user-menu";
import { NotificationBell } from "@/features/notifications/notification-bell";
import { AddDataButton } from "@/features/upload/add-data-button";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/query", label: "Query" },
  { href: "/anomalies", label: "Anomalies" },
  { href: "/consents", label: "Consents" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-border bg-surface shadow-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex flex-wrap items-center gap-6">
            <Link href="/dashboard" className="text-lg font-semibold text-text">
              Clarifi
            </Link>
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
