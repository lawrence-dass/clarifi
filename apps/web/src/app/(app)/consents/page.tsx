import { ConsentDashboard } from "@/features/fdx/consent-dashboard";

export default function ConsentsPage() {
  return (
    <div className="grid gap-6">
      <section>
        <h1 className="text-2xl font-semibold text-slate-950">Open Banking Consents</h1>
        <p className="mt-1 text-sm text-slate-600">
          Review and revoke the data-sharing consents you have granted. Revoking a consent
          immediately stops access to your transaction data for that connection.
        </p>
      </section>
      <ConsentDashboard />
    </div>
  );
}
