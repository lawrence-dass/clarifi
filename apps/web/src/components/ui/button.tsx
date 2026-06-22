import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-white hover:bg-primary-hover",
        ink: "bg-primary-ink text-white hover:bg-primary-ink/90",
        outline: "border border-border-strong bg-surface text-text hover:bg-canvas",
        ghost: "text-text-muted hover:bg-canvas hover:text-text",
        danger: "bg-danger text-white hover:bg-danger/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // Compact, reference-grade proportions (story 11.3): 32px tall toolbar
        // height with tight padding — the sleek "bank terminal" button.
        default: "h-8 px-3.5 text-sm",
        sm: "h-8 px-3 text-xs",
        // toolbar action — UPPERCASE tracked, per the reference
        action: "h-8 px-3 text-label uppercase",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
