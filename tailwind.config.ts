import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#1A1C21",
        brand: "#2B5CE2",
      },
    },
  },
  plugins: [],
};

export default config;
