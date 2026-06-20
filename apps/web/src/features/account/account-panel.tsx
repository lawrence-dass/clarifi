"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/auth";
import { useDeleteAccount } from "./account.hooks";

function formatMember(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function DeleteZone() {
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const router = useRouter();
  const deleteAccount = useDeleteAccount();

  async function handleDelete() {
    await deleteAccount.mutateAsync(password);
    router.replace("/sign-in");
  }

  if (!confirming) {
    return (
      <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
        Delete account
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-danger font-medium">
        This permanently deletes all your data. Enter your password to confirm.
      </p>
      <div className="space-y-1">
        <Label htmlFor="confirm-password">Password</Label>
        <input
          id="confirm-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="block w-full max-w-xs rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-primary"
          autoComplete="current-password"
        />
      </div>
      {deleteAccount.error ? (
        <p className="text-xs text-danger">{String(deleteAccount.error)}</p>
      ) : null}
      <div className="flex gap-2">
        <Button
          variant="danger"
          size="sm"
          disabled={!password || deleteAccount.isPending}
          onClick={handleDelete}
        >
          {deleteAccount.isPending ? "Deleting…" : "Confirm delete"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setConfirming(false); setPassword(""); }}
          disabled={deleteAccount.isPending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function AccountPanel() {
  const { data: user } = useSession();

  return (
    <div className="space-y-8">
      <section className="rounded border border-border bg-surface p-6 shadow-card space-y-4">
        <h2 className="text-sm font-semibold text-text">Profile</h2>
        <div className="space-y-1">
          <p className="label-micro">Email</p>
          <p className="text-sm text-text">{user?.email ?? "—"}</p>
        </div>
        <div className="space-y-1">
          <p className="label-micro">Member since</p>
          <p className="text-sm text-text">
            {user?.consentedAt ? formatMember(user.consentedAt) : "—"}
          </p>
        </div>
      </section>

      <section className="rounded border border-danger/30 bg-surface p-6 shadow-card space-y-4">
        <h2 className="text-sm font-semibold text-danger">Danger zone</h2>
        <p className="text-sm text-text-muted">
          Permanently delete your account and all associated data. This action cannot be
          undone and satisfies your PIPEDA right to erasure.
        </p>
        <DeleteZone />
      </section>
    </div>
  );
}
