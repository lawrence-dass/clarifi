import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./api-client";

export interface PublicUser {
  id: string;
  email: string;
  consentedAt: string;
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
