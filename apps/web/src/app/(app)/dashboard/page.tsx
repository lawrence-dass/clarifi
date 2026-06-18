import { ChartSmoke } from "@/components/chart-smoke";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardPage() {
  return (
    <div className="grid gap-6">
      <section>
        <h1 className="text-2xl font-semibold text-slate-950">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Authenticated shell and dashboard foundation are ready for feature widgets.
        </p>
      </section>
      <div className="grid gap-6 md:grid-cols-2">
        <ChartSmoke />
        <Card>
          <CardHeader>
            <CardTitle>Loading and error pattern</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <p className="text-sm text-slate-600">
              Feature views should render TanStack Query pending states with shared loading primitives
              and API errors with the shared error state component.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
