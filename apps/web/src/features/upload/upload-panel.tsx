"use client";

import { useState } from "react";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type BankFormat, useImportStatement } from "./upload.hooks";

const BANK_FORMATS: { value: BankFormat; label: string }[] = [
  { value: "generic", label: "Generic CSV" },
  { value: "td", label: "TD" },
  { value: "rbc", label: "RBC" },
  { value: "scotiabank", label: "Scotiabank" },
];

export function UploadPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [bankFormat, setBankFormat] = useState<BankFormat>("generic");
  const [institution, setInstitution] = useState("");
  const importStatement = useImportStatement();

  const canSubmit = file !== null && institution.trim().length > 0 && !importStatement.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !institution.trim()) return;
    importStatement.mutate({ file, bankFormat, institution: institution.trim() });
  }

  const result = importStatement.data;

  return (
    <section className="rounded border border-border bg-surface p-6 shadow-card">
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div>
          <Label htmlFor="csv-file">CSV file</Label>
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-text-muted file:mr-4 file:rounded-sm file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-primary-hover"
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="bank-format">Bank format</Label>
            <select
              id="bank-format"
              value={bankFormat}
              onChange={(e) => setBankFormat(e.target.value as BankFormat)}
              className="h-10 w-full rounded-sm border border-border-strong bg-surface px-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {BANK_FORMATS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="institution">Institution</Label>
            <Input
              id="institution"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              placeholder="e.g. TD Chequing"
              maxLength={100}
            />
          </div>
        </div>

        {importStatement.isError ? <ErrorState error={importStatement.error} /> : null}

        {result ? (
          <div className="rounded-sm border border-success/30 bg-success/10 px-4 py-3 text-sm text-text">
            Imported <span className="font-semibold tabular-nums">{result.imported}</span>{" "}
            transaction{result.imported === 1 ? "" : "s"}
            {result.duplicatesSkipped > 0 ? (
              <>
                {" "}·{" "}
                <span className="tabular-nums">{result.duplicatesSkipped}</span> duplicate
                {result.duplicatesSkipped === 1 ? "" : "s"} skipped
              </>
            ) : null}
            .
          </div>
        ) : null}

        <Button type="submit" disabled={!canSubmit}>
          {importStatement.isPending ? "Importing…" : "Import transactions"}
        </Button>
      </form>
    </section>
  );
}
