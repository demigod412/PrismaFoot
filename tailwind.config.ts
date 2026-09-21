import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#070B14", 900: "#0B1220", 800: "#111A2E", 700: "#1A2540" },
        edge: "#C8F542",
        ice: "#7DD3FC",
        amber: { DEFAULT: "#F5B942" },
        miss: "#F43F5E",
      },
      borderRadius: { card: "16px" },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "ui-monospace", "monospace"],
      },
      transitionTimingFunction: { out: "cubic-bezier(0.16, 1, 0.3, 1)" },
      transitionDuration: { DEFAULT: "200ms" },
    },
  },
  plugins: [],
} satisfies Config;
