"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { AnomaliesResult } from "@/features/notifications/notification.types";

export function useAnomalies() {
  return useQuery({
    queryKey: ["anomalies"],
    queryFn: () => apiClient<AnomaliesResult>("/anomalies?limit=50"),
  });
}

export function useDismissAnomaly() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient(`/anomalies/${id}/dismiss`, { method: "PATCH" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["anomalies"] });
      void qc.invalidateQueries({ queryKey: ["critical-anomalies"] });
    },
  });
}

export function useReportAnomaly() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient(`/anomalies/${id}/report`, { method: "PATCH" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["anomalies"] });
    },
  });
}
