"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text">Create your account</h1>
        <p className="mt-1 text-sm text-text-muted">Start tracking your finances with Clarifi.</p>
      </div>
      <form className="space-y-5" onSubmit={form.handleSubmit((values) => register.mutate(values))}>
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
            autoComplete="new-password"
            placeholder="12+ characters"
            type="password"
            {...form.register("password")}
          />
          <FieldError message={form.formState.errors.password?.message} />
        </div>
        <label className="flex gap-3 text-sm text-text-muted">
          <input type="checkbox" className="mt-0.5 accent-primary" {...form.register("consent")} />
          I consent to Clarifi processing my account and transaction data.
        </label>
        <FieldError message={form.formState.errors.consent?.message} />
        {register.isError ? <ErrorState error={register.error} /> : null}
        <Button type="submit" className="w-full" disabled={register.isPending}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-sm text-text-muted">
        Already registered?{" "}
        <Link href="/sign-in" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-danger">{message}</p>;
}
