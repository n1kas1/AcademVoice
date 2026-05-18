/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--tg-theme-bg-color, #0f0f0f)",
        fg: "var(--tg-theme-text-color, #ffffff)",
        muted: "var(--tg-theme-hint-color, #8a8a8a)",
        accent: "var(--tg-theme-button-color, #2ea6ff)",
      },
    },
  },
  plugins: [],
};
