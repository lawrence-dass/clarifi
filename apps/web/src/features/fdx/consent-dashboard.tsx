"use client";

import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { useConsents, useRevokeConsent } from "./consent.hooks";
import type { Consent } from "./consent.types";

function scopeLabel(scope: string): string {
  const labels: Record<string, string> = {
    "accounts:read": "Read accounts",
    "transactions:read": "Read transactions",
    "customers:read": "Read customer info",
  };
  return labels[scope] ?? scope;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function ConsentCard({ consent }: { consent: Consent }) {
  const revoke = useRevokeConsent();
  const isGranted = consent.status === "granted";

  return (
    <div className="rounded-md border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                isGranted
                  ? "bg-teal-50 text-teal-700"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {isGranted ? "Active" : "Revoked"}
            </span>
            <span className="text-xs text-slate-400">FDX consent</span>
          </div>
          <ul className="mt-2 space-y-1">
            {consent.scopes.map((scope) => (
              <li key={scope} className="flex items-center gap-1.5 text-sm text-slate-700">
                <span className="text-teal-600" aria-hidden>✓</span>
                {scopeLabel(scope)}
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-400">
            Granted {formatDate(consent.grantedAt)}
            {consent.revokedAt ? ` · Revoked ${formatDate(consent.revokedAt)}` : ""}
          </p>
        </div>

        {isGranted ? (
          <Button
            variant="outline"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate(consent.id)}
            className="text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            {revoke.isPending ? "Revoking…" : "Revoke"}
          </Button>
        ) : null}
      </div>

      {revoke.error ? (
        <div className="mt-3">
          <ErrorState error={revoke.error} />
        </div>
      ) : null}
    </div>
  );
}

export function ConsentDashboard() {
  const { data, isPending, error } = useConsents();

  if (isPending) {
    return (
      <div className="space-y-4">
        {[1, 2].map((n) => (
          <div key={n} className="h-28 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return <ErrorState error={error} />;
  }

  const consents = data?.consents ?? [];

  if (consents.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-slate-600">No open banking consents yet.</p>
        <p className="mt-1 text-sm text-slate-400">
          Consents appear here after you connect an FDX data provider.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {consents.map((consent) => (
        <ConsentCard key={consent.id} consent={consent} />
      ))}
    </div>
  );
}
