import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.apexiavip.app",
  appName: "Apexia VIP",
  webDir: "dist",
  backgroundColor: "#0b0a08",
  ios: {
    // The page draws under the status bar and home indicator itself, using
    // the safe-area insets (viewport-fit=cover is set inside the app)
    contentInset: "never",
    // Long-press link previews are a browser habit, not an app one
    allowsLinkPreview: false,
  },
};

export default config;
