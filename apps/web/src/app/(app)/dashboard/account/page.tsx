import { AccountPanel } from "@/features/account/account-panel";

export default function AccountPage() {
  return (
    <div className="grid gap-6">
      <section>
        <h1 className="text-2xl font-semibold text-text">Account</h1>
        <p className="mt-1 text-sm text-text-muted">
          Manage your profile and account settings.
        </p>
      </section>
      <AccountPanel />
    </div>
  );
}
