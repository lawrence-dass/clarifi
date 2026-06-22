"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api-client";
import type { PublicUser } from "@/lib/auth";

/**
 * "Try the live demo" entry (Story 12.1). One click provisions an ephemeral,
 * RLS-isolated demo user (seeded with synthetic data), starts an authenticated
 * session via cookies, and drops the visitor into the dashboard.
 */
export function TryDemoButton({ fullWidth = false }: { fullWidth?: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const demo = useMutation({
    mutationFn: () => apiClient<PublicUser>("/demo/session", { method: "POST" }),
    onSuccess: (user) => {
      queryClient.setQueryData(["session"], user);
      router.replace("/dashboard");
    },
  });

  return (
    <div className={fullWidth ? "w-full" : undefined}>
      <Button
        type="button"
        variant="outline"
        onClick={() => demo.mutate()}
        disabled={demo.isPending}
        className={fullWidth ? "w-full" : undefined}
      >
        {demo.isPending ? "Preparing your demo…" : "Try the live demo"}
      </Button>
      {demo.isError ? (
        <div className="mt-2">
          <ErrorState error={demo.error} />
        </div>
      ) : null}
    </div>
  );
}
