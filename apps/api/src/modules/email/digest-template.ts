import type { DigestData } from "./digest.service.js";

function formatCents(cents: bigint, currency: string): string {
  const dollars = Math.abs(Number(cents)) / 100;
  return `${currency} $${dollars.toFixed(2)}`;
}

function categoryLabel(category: string): string {
  return category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function buildDigestSubject(data: DigestData): string {
  const spend = formatCents(data.totalSpendCents, data.currency);
  return `Clarifi weekly digest: ${spend} spent ${data.weekStart} – ${data.weekEnd}`;
}

export function buildDigestText(data: DigestData): string {
  const lines: string[] = [
    `Weekly spending digest for ${data.email}`,
    `Period: ${data.weekStart} to ${data.weekEnd}`,
    "",
    `Total spend: ${formatCents(data.totalSpendCents, data.currency)}`,
    "",
  ];

  if (data.topCategories.length > 0) {
    lines.push("Top spending categories:");
    for (const cat of data.topCategories) {
      lines.push(`  ${categoryLabel(cat.category)}: ${formatCents(cat.totalCents, data.currency)}`);
    }
    lines.push("");
  }

  if (data.criticalAnomalyCount > 0) {
    lines.push(`Critical anomalies: ${data.criticalAnomalyCount} unreviewed`);
    lines.push("  Log into Clarifi to review and dismiss these.");
    lines.push("");
  }

  if (data.overBudgetCategories.length > 0) {
    lines.push("Budget alerts:");
    for (const b of data.overBudgetCategories) {
      const status = b.percentUsed >= 100 ? "Over budget" : "Near limit";
      lines.push(`  ${categoryLabel(b.category)}: ${b.percentUsed}% used (${status})`);
    }
    lines.push("");
  }

  lines.push("--");
  lines.push("Clarifi · Manage your preferences in the app");
  return lines.join("\n");
}

export function buildDigestHtml(data: DigestData): string {
  const spend = formatCents(data.totalSpendCents, data.currency);

  const categoriesHtml =
    data.topCategories.length > 0
      ? `<h3 style="margin:16px 0 8px;font-size:14px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Top categories</h3>
<table style="width:100%;border-collapse:collapse">
${data.topCategories
  .map(
    (cat) =>
      `<tr><td style="padding:4px 0;color:#0f172a">${categoryLabel(cat.category)}</td>
<td style="padding:4px 0;text-align:right;font-weight:600;color:#0f172a">${formatCents(cat.totalCents, data.currency)}</td></tr>`,
  )
  .join("")}
</table>`
      : "";

  const anomalyHtml =
    data.criticalAnomalyCount > 0
      ? `<div style="margin-top:16px;padding:12px;background:#fef2f2;border-radius:6px;border:1px solid #fecaca">
<p style="margin:0;font-weight:600;color:#dc2626">⚠ ${data.criticalAnomalyCount} critical anomaly alert${data.criticalAnomalyCount > 1 ? "s" : ""}</p>
<p style="margin:4px 0 0;font-size:13px;color:#7f1d1d">Log into Clarifi to review and dismiss.</p>
</div>`
      : "";

  const budgetHtml =
    data.overBudgetCategories.length > 0
      ? `<div style="margin-top:16px;padding:12px;background:#fff7ed;border-radius:6px;border:1px solid #fed7aa">
<p style="margin:0;font-weight:600;color:#c2410c">Budget alerts</p>
${data.overBudgetCategories
  .map(
    (b) =>
      `<p style="margin:4px 0 0;font-size:13px;color:#9a3412">${categoryLabel(b.category)}: ${b.percentUsed}% used${b.percentUsed >= 100 ? " (over budget)" : " (near limit)"}</p>`,
  )
  .join("")}
</div>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Clarifi weekly digest</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:32px 16px">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden">
  <div style="background:#0f172a;padding:24px 32px">
    <h1 style="margin:0;font-size:20px;color:#fff;font-weight:700">Clarifi</h1>
    <p style="margin:4px 0 0;font-size:13px;color:#94a3b8">Weekly spending digest</p>
  </div>
  <div style="padding:24px 32px">
    <p style="margin:0;color:#64748b;font-size:13px">${data.weekStart} – ${data.weekEnd}</p>
    <h2 style="margin:8px 0 0;font-size:28px;font-weight:700;color:#0f172a">${spend}</h2>
    <p style="margin:4px 0 0;font-size:13px;color:#64748b">total spend this week</p>
    ${categoriesHtml}
    ${anomalyHtml}
    ${budgetHtml}
  </div>
  <div style="padding:16px 32px;border-top:1px solid #e2e8f0;background:#f8fafc">
    <p style="margin:0;font-size:12px;color:#94a3b8">Manage your preferences in the Clarifi app.</p>
  </div>
</div>
</body>
</html>`;
}
