import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./api-client";

export type DemoKind = "csv" | "plaid";

export interface PublicUser {
  id: string;
  email: string;
  consentedAt: string;
  // True for one-click public-demo sessions (Story 12.1).
  isDemo: boolean;
  // Which demo flavor (Story 12.3); null for real users.
  demoKind: DemoKind | null;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload extends LoginPayload {
  consent: true;
}

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => apiClient<PublicUser>("/auth/me"),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient<void>("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
    },
  });
}
