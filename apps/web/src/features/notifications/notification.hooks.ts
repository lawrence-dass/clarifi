import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { AnomaliesResult } from "./notification.types";

const POLL_INTERVAL_MS = 30_000; // poll every 30 seconds

export const notificationKeys = {
  critical: () => ["anomalies", "critical"] as const,
};

export function useCriticalAnomalies() {
  return useQuery({
    queryKey: notificationKeys.critical(),
    queryFn: () =>
      apiClient<AnomaliesResult>("/anomalies?severity=critical&limit=10"),
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useDismissAnomaly() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (anomalyId: string) =>
      apiClient<void>(`/anomalies/${anomalyId}/dismiss`, { method: "PATCH" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.critical() });
    },
  });
}
