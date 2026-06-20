"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/error-state";
import { Loading } from "@/components/loading";
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
    <div className="rounded border border-border bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge tone={isGranted ? "success" : "info"}>
              {isGranted ? "Active" : "Revoked"}
            </Badge>
            <span className="label-micro">FDX consent</span>
          </div>
          <ul className="space-y-1">
            {consent.scopes.map((scope) => (
              <li key={scope} className="flex items-center gap-1.5 text-sm text-text">
                <span className="text-success" aria-hidden>✓</span>
                {scopeLabel(scope)}
              </li>
            ))}
          </ul>
          <p className="text-xs text-text-faint">
            Granted {formatDate(consent.grantedAt)}
            {consent.revokedAt ? ` · Revoked ${formatDate(consent.revokedAt)}` : ""}
          </p>
        </div>

        {isGranted ? (
          <Button
            variant="danger"
            size="sm"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate(consent.id)}
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

  if (isPending) return <Loading label="Loading consents" />;
  if (error) return <ErrorState error={error} />;

  const consents = data?.consents ?? [];

  if (consents.length === 0) {
    return (
      <div className="rounded border border-dashed border-border px-6 py-12 text-center">
        <p className="text-sm font-medium text-text">No open banking consents yet.</p>
        <p className="mt-1 text-xs text-text-muted">
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
