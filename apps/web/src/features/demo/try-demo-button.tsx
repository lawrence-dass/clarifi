"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api-client";
import type { DemoKind, PublicUser } from "@/lib/auth";

const LABELS: Record<DemoKind, string> = {
  csv: "Demo with sample CSV",
  plaid: "Demo with Plaid (open banking)",
};

// Public Turnstile site key. Unset → no widget is rendered and the server-side
// bot-gate bypasses too (dev/CI parity). Set → a challenge must pass before mint.
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TOKEN_HEADER = "cf-turnstile-response";

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  reset: (id?: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * "Try the live demo" entry (Story 12.1). One click provisions an ephemeral,
 * RLS-isolated demo user and drops the visitor into the dashboard.
 *
 * Story 12.2: when a Turnstile site key is configured, a bot challenge must pass
 * first; its token is sent as the `cf-turnstile-response` header and verified
 * server-side before any provisioning. With no site key, the button behaves
 * exactly as before (the server bypasses the gate in dev/CI).
 */
export function TryDemoButton({
  kind,
  fullWidth = false,
}: {
  kind: DemoKind;
  fullWidth?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY || typeof window === "undefined") return;
    let cancelled = false;

    const renderWidget = () => {
      if (cancelled || !widgetRef.current || !window.turnstile || widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(widgetRef.current, {
        sitekey: SITE_KEY,
        callback: (t) => setToken(t),
        "expired-callback": () => setToken(null),
        "error-callback": () => setToken(null),
      });
    };

    if (window.turnstile) {
      renderWidget();
    } else if (!document.querySelector(`script[src="${SCRIPT_SRC}"]`)) {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = renderWidget;
      document.head.appendChild(script);
    } else {
      const poll = setInterval(() => {
        if (window.turnstile) {
          clearInterval(poll);
          renderWidget();
        }
      }, 200);
      setTimeout(() => clearInterval(poll), 5000);
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const demo = useMutation({
    mutationFn: () =>
      apiClient<PublicUser>("/demo/session", {
        method: "POST",
        body: { kind },
        headers: SITE_KEY && token ? { [TOKEN_HEADER]: token } : undefined,
      }),
    onSuccess: (user) => {
      queryClient.setQueryData(["session"], user);
      router.replace("/dashboard");
    },
    onError: () => {
      // Turnstile tokens are single-use — reset the widget so the user can retry.
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
        setToken(null);
      }
    },
  });

  const needsToken = Boolean(SITE_KEY);
  const disabled = demo.isPending || (needsToken && !token);

  return (
    <div className={fullWidth ? "w-full" : undefined}>
      {needsToken ? <div ref={widgetRef} className="mb-2" /> : null}
      <Button
        type="button"
        variant="outline"
        onClick={() => demo.mutate()}
        disabled={disabled}
        className={fullWidth ? "w-full" : undefined}
      >
        {demo.isPending ? "Preparing your demo…" : LABELS[kind]}
      </Button>
      {demo.isError ? (
        <div className="mt-2">
          <ErrorState error={demo.error} />
        </div>
      ) : null}
    </div>
  );
}
