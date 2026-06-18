"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLogout, useSession } from "@/lib/auth";
import { Button } from "./ui/button";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/upload", label: "Upload" },
  { href: "/dashboard/budgets", label: "Budgets" },
  { href: "/dashboard/account", label: "Account" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const session = useSession();
  const logout = useLogout();

  async function signOut() {
    await logout.mutateAsync();
    router.replace("/sign-in");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div>
            <Link href="/dashboard" className="text-lg font-semibold text-slate-950">
              Clarifi
            </Link>
            <p className="text-xs text-slate-500">{session.data?.email}</p>
          </div>
          <nav className="flex flex-wrap items-center gap-2 text-sm">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              >
                {item.label}
              </Link>
            ))}
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
