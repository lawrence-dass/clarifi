"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api-client";
import type { LoginPayload, PublicUser } from "@/lib/auth";
import { TryDemoButton } from "@/features/demo/try-demo-button";

const SignInSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1),
});

type SignInForm = z.infer<typeof SignInSchema>;

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const form = useForm<SignInForm>({
    resolver: zodResolver(SignInSchema),
    defaultValues: { email: "", password: "" },
  });
  const login = useMutation({
    mutationFn: (payload: LoginPayload) =>
      apiClient<PublicUser>("/auth/login", { method: "POST", body: payload }),
    onSuccess: (user) => {
      queryClient.setQueryData(["session"], user);
      router.replace(safeNextPath(searchParams.get("next")));
    },
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text">Sign in to Clarifi</h1>
        <p className="mt-1 text-sm text-text-muted">Enter your credentials to continue.</p>
      </div>
      <form className="space-y-5" onSubmit={form.handleSubmit((values) => login.mutate(values))}>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            autoComplete="email"
            placeholder="you@example.com"
            {...form.register("email")}
          />
          <FieldError message={form.formState.errors.email?.message} />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            autoComplete="current-password"
            placeholder="••••••••"
            type="password"
            {...form.register("password")}
          />
          <FieldError message={form.formState.errors.password?.message} />
        </div>
        {login.isError ? <ErrorState error={login.error} /> : null}
        <Button type="submit" className="w-full" disabled={login.isPending}>
          Sign in
        </Button>
      </form>
      <div className="my-6 flex items-center gap-3 text-xs text-text-faint">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="space-y-2">
        <TryDemoButton kind="csv" fullWidth />
        <TryDemoButton kind="plaid" fullWidth />
      </div>
      <p className="mt-2 text-center text-xs text-text-faint">
        Explore with synthetic data — no signup required.
      </p>
      <p className="mt-6 text-sm text-text-muted">
        Need an account?{" "}
        <Link href="/sign-up" className="font-medium text-primary hover:underline">
          Create one
        </Link>
      </p>
    </main>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-danger">{message}</p>;
}

function safeNextPath(next: string | null): string {
  if (next?.startsWith("/") && !next.startsWith("//")) return next;
  return "/dashboard";
}
