"use client";

import { type ReactNode, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ApiError } from "@/lib/api-client";
import { useSession } from "@/lib/auth";
import { ErrorState } from "./error-state";
import { Loading } from "./loading";

export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSession();

  useEffect(() => {
    if (session.error instanceof ApiError && session.error.status === 401) {
      router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
    }
  }, [pathname, router, session.error]);

  if (session.isPending) return <Loading label="Checking session" />;
  if (session.error instanceof ApiError && session.error.status === 401) return null;
  if (session.isError) return <ErrorState error={session.error} />;

  return <>{children}</>;
}
