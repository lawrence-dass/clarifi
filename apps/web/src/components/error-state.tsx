import { ApiError } from "@/lib/api-client";

export function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof ApiError ? error.message : "Something went wrong";

  return (
    <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
      {message}
    </div>
  );
}
