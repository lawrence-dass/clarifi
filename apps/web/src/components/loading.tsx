export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center text-sm text-slate-500">
      {label}
    </div>
  );
}
