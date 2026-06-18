import { ApiError } from "@/lib/api-client";

export function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof ApiError ? error.message : "Something went wrong";

  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      {message}
    </div>
  );
}
