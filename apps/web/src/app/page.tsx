import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <h1 className="text-4xl font-bold tracking-tight">Clarifi</h1>
      <p className="text-lg text-slate-600">
        Clarity on where your money goes — categorization, anomaly detection, and
        plain-English answers about your own financial data.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/sign-in">Sign in</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/sign-up">Create account</Link>
        </Button>
      </div>
    </main>
  );
}
