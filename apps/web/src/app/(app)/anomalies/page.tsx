import { AnomalyFeed } from "@/features/anomaly/anomaly-feed";

export default function AnomaliesPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text">Anomaly feed</h1>
        <p className="mt-1 text-sm text-text-muted">
          Unusual spending patterns detected in your accounts.
        </p>
      </div>
      <AnomalyFeed />
    </div>
  );
}
