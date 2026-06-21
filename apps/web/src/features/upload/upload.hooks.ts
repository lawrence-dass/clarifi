"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export type BankFormat = "td" | "rbc" | "scotiabank" | "generic";

export interface ImportInput {
  file: File;
  bankFormat: BankFormat;
  institution: string;
}

export interface ImportResult {
  accountId: string;
  imported: number;
  duplicatesSkipped: number;
}

export function useImportStatement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, bankFormat, institution }: ImportInput) => {
      // Multipart: field `file` (the CSV) + bankFormat + institution. apiClient
      // forwards FormData as-is and lets the browser set the multipart boundary.
      const body = new FormData();
      body.append("file", file);
      body.append("bankFormat", bankFormat);
      body.append("institution", institution);
      return apiClient<ImportResult>("/transactions/import", { method: "POST", body });
    },
    onSuccess: () => {
      // Newly imported transactions change every dashboard view — refresh them.
      for (const key of ["category-breakdown", "spending-trend", "summary", "budgets"]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
