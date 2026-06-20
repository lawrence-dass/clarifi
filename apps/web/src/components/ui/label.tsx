import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Form field / section micro-label — the signature UPPERCASE letter-spaced
 * label from the reference (see docs/design-reference.md §3).
 */
export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("label-micro mb-1.5 block", className)} {...props} />;
}
