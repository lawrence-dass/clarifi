import { QueryChat } from "@/features/nl-query/query-chat";

export default function QueryPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text">Ask your finances</h1>
        <p className="mt-1 text-sm text-text-muted">
          Natural language questions about your spending, answered in seconds.
        </p>
      </div>
      <QueryChat />
    </div>
  );
}
