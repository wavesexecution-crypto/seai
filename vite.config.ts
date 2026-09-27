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
    // NOTE: cssCodeSplit stays at the Vite default (true) on purpose.
    // With `false`, Vite merges every entry's CSS into one file and links
    // it from ALL entries — which injected 40KB+ of irrelevant homepage
    // CSS (and Tailwind preflight, which competes in the cascade) into
    // every /examples/*.html demo as an extra render-blocking request.
    // The demos carry their styles inline and must load zero external CSS.
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        intake: resolve(__dirname, "intake.html"),
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