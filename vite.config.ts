import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        intake: resolve(__dirname, "intake.html"),
        pricing: resolve(__dirname, "pricing.html"),
        examples: resolve(__dirname, "examples.html"),
        services: resolve(__dirname, "services.html"),
        industries: resolve(__dirname, "industries.html"),
        contact: resolve(__dirname, "contact.html"),
        terms: resolve(__dirname, "terms.html"),
        privacy: resolve(__dirname, "privacy.html"),
        notfound: resolve(__dirname, "404.html"),
        restaurant: resolve(__dirname, "examples/restaurant.html"),
        gym: resolve(__dirname, "examples/gym.html"),
        salon: resolve(__dirname, "examples/salon.html"),
        cafe: resolve(__dirname, "examples/cafe.html"),
        clinic: resolve(__dirname, "examples/clinic.html"),
        realestate: resolve(__dirname, "examples/real-estate.html"),
        business: resolve(__dirname, "examples/business.html")
      }
    }
  }
});