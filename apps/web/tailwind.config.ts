import type { Config } from "tailwindcss";

/**
 * Design tokens — see docs/design-reference.md.
 * Colors are stored as space-separated RGB channels in CSS variables
 * (globals.css) and referenced via rgb(var(--x) / <alpha-value>) so that
 * Tailwind opacity modifiers (e.g. bg-cat-blue/10) still work — needed for
 * the soft tinted chart fills and event blocks.
 */
const rgb = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: rgb("--canvas"),
        surface: rgb("--surface"),
        border: rgb("--border"),
        "border-strong": rgb("--border-strong"),
        text: rgb("--text"),
        "text-muted": rgb("--text-muted"),
        "text-faint": rgb("--text-faint"),
        primary: {
          DEFAULT: rgb("--primary"),
          hover: rgb("--primary-hover"),
          ink: rgb("--primary-ink"),
        },
        success: rgb("--success"),
        danger: rgb("--danger"),
        warning: rgb("--warning"),
        info: rgb("--info"),
        // categorical palette (charts, tags, tinted blocks)
        "cat-blue": rgb("--cat-blue"),
        "cat-teal": rgb("--cat-teal"),
        "cat-green": rgb("--cat-green"),
        "cat-amber": rgb("--cat-amber"),
        "cat-pink": rgb("--cat-pink"),
        "cat-purple": rgb("--cat-purple"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      fontSize: {
        // micro-label: 11px uppercase tracked — the signature pattern
        label: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.04em", fontWeight: "600" }],
        kpi: ["2rem", { lineHeight: "2.25rem", fontWeight: "700" }],
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "6px",
        md: "6px",
        lg: "8px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(28, 39, 60, 0.04)",
        modal: "0 8px 24px rgba(28, 39, 60, 0.12)",
      },
      ringColor: {
        DEFAULT: rgb("--primary"),
      },
    },
  },
  plugins: [],
} satisfies Config;
