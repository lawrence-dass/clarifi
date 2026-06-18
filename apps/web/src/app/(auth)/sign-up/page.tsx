"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";
import type { PublicUser, RegisterPayload } from "@/lib/auth";

const SignUpSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(128),
  consent: z.literal(true),
});

type SignUpForm = z.infer<typeof SignUpSchema>;

export default function SignUpPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<SignUpForm>({
    resolver: zodResolver(SignUpSchema),
    defaultValues: { email: "", password: "", consent: true },
  });
  const register = useMutation({
    mutationFn: async (payload: RegisterPayload) => {
      await apiClient<PublicUser>("/auth/register", { method: "POST", body: payload });
      return apiClient<PublicUser>("/auth/login", {
        method: "POST",
        body: { email: payload.email, password: payload.password },
      });
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["session"], user);
      router.replace("/dashboard");
    },
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Card>
        <CardHeader>
          <CardTitle>Create account</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={form.handleSubmit((values) => register.mutate(values))}>
            <FieldError message={form.formState.errors.email?.message} />
            <Input autoComplete="email" placeholder="Email" {...form.register("email")} />
            <FieldError message={form.formState.errors.password?.message} />
            <Input
              autoComplete="new-password"
              placeholder="Password"
              type="password"
              {...form.register("password")}
            />
            <label className="flex gap-3 text-sm text-slate-700">
              <input type="checkbox" className="mt-1" {...form.register("consent")} />
              I consent to Clarifi processing my account and transaction data.
            </label>
            <FieldError message={form.formState.errors.consent?.message} />
            {register.isError ? <ErrorState error={register.error} /> : null}
            <Button type="submit" className="w-full" disabled={register.isPending}>
              Create account
            </Button>
          </form>
          <p className="mt-4 text-sm text-slate-600">
            Already registered?{" "}
            <Link href="/sign-in" className="font-medium text-slate-950 underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-red-700">{message}</p>;
}
