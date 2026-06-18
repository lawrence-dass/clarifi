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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";
import type { LoginPayload, PublicUser } from "@/lib/auth";

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={form.handleSubmit((values) => login.mutate(values))}>
            <FieldError message={form.formState.errors.email?.message} />
            <Input autoComplete="email" placeholder="Email" {...form.register("email")} />
            <FieldError message={form.formState.errors.password?.message} />
            <Input
              autoComplete="current-password"
              placeholder="Password"
              type="password"
              {...form.register("password")}
            />
            {login.isError ? <ErrorState error={login.error} /> : null}
            <Button type="submit" className="w-full" disabled={login.isPending}>
              Sign in
            </Button>
          </form>
          <p className="mt-4 text-sm text-slate-600">
            Need an account?{" "}
            <Link href="/sign-up" className="font-medium text-slate-950 underline">
              Create one
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

function safeNextPath(next: string | null): string {
  if (next?.startsWith("/") && !next.startsWith("//")) return next;
  return "/dashboard";
}
