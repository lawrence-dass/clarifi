import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { ConsentsResult } from "./consent.types";

export const consentKeys = {
  list: () => ["fdx-consents"] as const,
};

export function useConsents() {
  return useQuery({
    queryKey: consentKeys.list(),
    queryFn: () => apiClient<ConsentsResult>("/fdx/oauth/consents"),
  });
}

export function useRevokeConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (consentId: string) =>
      apiClient<void>(`/fdx/oauth/consents/${consentId}/revoke`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: consentKeys.list() });
    },
  });
}
