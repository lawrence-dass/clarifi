import { UploadPanel } from "@/features/upload/upload-panel";

export default function UploadPage() {
  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <section>
        <h1 className="text-2xl font-semibold text-text">Upload transactions</h1>
        <p className="mt-1 text-sm text-text-muted">
          Import a CSV bank statement. Duplicates are detected automatically, so re-importing
          the same file is safe.
        </p>
      </section>
      <UploadPanel />
    </div>
  );
}
