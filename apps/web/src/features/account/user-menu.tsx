"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLogout, useSession } from "@/lib/auth";

function initials(email: string | undefined): string {
  if (!email) return "?";
  return email.trim().charAt(0).toUpperCase() || "?";
}

/**
 * Identity menu in the app-shell header. Holds what used to be the loose email
 * and the in-nav sign-out: the signed-in email, a link to Profile & settings
 * (the existing /dashboard/account page), and Sign out. Same overlay idiom as
 * the notification popover.
 */
export function UserMenu() {
  const router = useRouter();
  const session = useSession();
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const email = session.data?.email;

  async function signOut() {
    await logout.mutateAsync();
    router.replace("/sign-in");
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded px-2 py-1.5 text-text-muted hover:bg-canvas hover:text-text"
        aria-label="Account menu"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
          aria-hidden
        >
          {initials(email)}
        </span>
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-20 mt-1 w-60 rounded border border-border bg-surface shadow-modal">
            <div className="border-b border-border px-4 py-3">
              <p className="text-xs text-text-faint">Signed in as</p>
              <p className="truncate text-sm font-medium text-text">{email ?? "—"}</p>
            </div>
            <div className="p-1">
              <Link
                href="/dashboard/account"
                onClick={() => setOpen(false)}
                className="block rounded px-3 py-2 text-sm text-text-muted hover:bg-canvas hover:text-text"
              >
                Profile &amp; settings
              </Link>
            </div>
            <div className="border-t border-border p-3">
              <Button
                type="button"
                variant="outline"
                onClick={signOut}
                disabled={logout.isPending}
                className="w-full"
              >
                Sign out
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
