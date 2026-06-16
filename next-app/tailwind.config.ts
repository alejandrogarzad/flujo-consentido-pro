import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx,js,jsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-nunito)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        // Remapeo: en toda la app "violet-*" pasa a ser el morado de marca Con-sentido
        // (#9B5DE5). Esto reskinéa decenas de páginas sin tocar sus clases una por una.
        violet: {
          50: "#F5EEFC",
          100: "#EBDDFA",
          200: "#D9C0F4",
          300: "#C29BEC",
          400: "#AE7AE7",
          500: "#9B5DE5",
          600: "#8A45D8",
          700: "#7330B8",
          800: "#592591",
          900: "#3F1A69",
        },
        // Colores de marca prefijados (no colisionan con los teal/sky/amber/green de Tailwind)
        brand: {
          coral: { soft: "#FDEAEF", DEFAULT: "#F0567A", dark: "#B8284A" },
          amber: { soft: "#FEF2DC", DEFAULT: "#FBB034", dark: "#97650C" },
          teal: { soft: "#DCF6F1", DEFAULT: "#2BC4AE", dark: "#0F7A6A" },
          sky: { soft: "#E0F3FC", DEFAULT: "#43BCEC", dark: "#0F76A6" },
          purple: { soft: "#EFE6FB", DEFAULT: "#9B5DE5", dark: "#6B36B8" },
          green: { soft: "#E2F6E8", DEFAULT: "#5DC97B", dark: "#1E7C42" },
        },
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
