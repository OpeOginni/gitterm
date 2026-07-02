import type { TailwindConfig } from "@react-email/components";

/**
 * Tailwind config for transactional emails, mirroring the app's dark theme
 * tokens (apps/web/src/index.css `.dark`). Keep these in sync so emails stay
 * visually consistent with the product UI.
 */
export const emailTailwindConfig: TailwindConfig = {
  theme: {
    extend: {
      colors: {
        background: "#09090b",
        card: "#0c0c10",
        popover: "#0e0e11",
        "surface-2": "#151518",
        foreground: "#f5f5f6",
        "muted-foreground": "#9a9aa2",
        faint: "#6b6b73",
        primary: "#c8a44e",
        "primary-foreground": "#09090b",
        border: "#26262b",
        "border-soft": "#1c1c20",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        serif: ["Georgia", "Times New Roman", "serif"],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      borderRadius: {
        xl: "12px",
        "2xl": "16px",
      },
    },
  },
};

/** White-ish canvas surrounding the dark invite card. */
export const EMAIL_CANVAS = "#f4f4f5";
