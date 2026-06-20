"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLogout, useSession } from "@/lib/auth";
import { NotificationBell } from "@/features/notifications/notification-bell";
import { Button } from "./ui/button";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/upload", label: "Upload" },
  { href: "/dashboard/budgets", label: "Budgets" },
  { href: "/consents", label: "Consents" },
  { href: "/dashboard/account", label: "Account" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSession();
  const logout = useLogout();

  async function signOut() {
    await logout.mutateAsync();
    router.replace("/sign-in");
  }

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-border bg-surface shadow-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div>
            <Link href="/dashboard" className="text-lg font-semibold text-text">
              Clarifi
            </Link>
            <p className="text-xs text-text-muted">{session.data?.email}</p>
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
            <NotificationBell />
            <Button type="button" variant="outline" onClick={signOut} disabled={logout.isPending}>
              Sign out
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
