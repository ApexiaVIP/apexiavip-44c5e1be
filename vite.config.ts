import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
// The partner travel desk is desktop only. Native builds swap it for a stub so
// the portal, and the club artwork it imports, never enter the app bundle.
const nativeBuild = process.env.VITE_NATIVE_BUILD === "true";

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      // The cameras are precached deliberately: the warning is worth most on
      // the roads where the signal drops, so the file has to be on the phone
      // before it is wanted rather than fetched when it is
      includeAssets: ["pwa-192.png", "pwa-512.png", "speed-cameras.json"],
      manifest: {
        name: "Apexia VIP",
        short_name: "Apexia VIP",
        description:
          "Members-only executive transport. Book, track your chauffeur, and manage your membership.",
        id: "/",
        start_url: "/",
        display: "standalone",
        background_color: "#0b0a08",
        theme_color: "#0b0a08",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The app is online-first (bookings, auth); cache the shell only
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/functions\//],
        globPatterns: ["**/*.{js,css,html,png,jpg,svg,ico}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ].filter(Boolean),
  // The map engine's worker is an ES module, so emit workers as modules
  worker: {
    format: "es",
  },
  resolve: {
    alias: {
      ...(nativeBuild
        ? {
            "@/pages/McfcPortal": path.resolve(__dirname, "./src/pages/McfcPortalNative.tsx"),
          }
        : {}),
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
