import type { ReactNode } from "react";
import { ErrorState } from "@/components/error-state";
import { Loading } from "@/components/loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function SectionFrame({
  title,
  isPending,
  error,
  isEmpty,
  emptyMessage,
  footer,
  children,
}: {
  title: string;
  isPending: boolean;
  error: unknown;
  isEmpty: boolean;
  emptyMessage: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {isPending ? <Loading label={`Loading ${title.toLowerCase()}`} /> : null}
        {!isPending && error ? <ErrorState error={error} /> : null}
        {!isPending && !error && isEmpty ? <EmptyState message={emptyMessage} /> : null}
        {!isPending && !error && !isEmpty ? children : null}
        {!isPending && !error && footer ? footer : null}
      </CardContent>
    </Card>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded border border-dashed border-border px-4 py-8 text-center text-sm text-text-muted">
      {message}
    </div>
  );
}
