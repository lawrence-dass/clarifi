"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) =>
      apiClient<{ deleted: true }>("/auth/me", { method: "DELETE", body: { password } }),
    onSuccess: () => {
      qc.clear();
    },
  });
}
