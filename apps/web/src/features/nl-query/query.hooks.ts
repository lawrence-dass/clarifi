"use client";

import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export interface QueryRow {
  [key: string]: string | number | null;
}

export interface NLQueryResponse {
  interpretation: string;
  rows: QueryRow[];
  metric: string;
  dimensions: string[];
}

export function useNLQuery() {
  return useMutation({
    mutationFn: (question: string) =>
      apiClient<NLQueryResponse>("/query/nl", { method: "POST", body: { question } }),
  });
}
