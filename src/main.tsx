import "./lib/authHash"; // must run before the Supabase client consumes the URL hash
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
// Self-hosted fonts: nothing is fetched from Google
import "@fontsource/cormorant-garamond/300.css";
import "@fontsource/cormorant-garamond/400.css";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/inter/300.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "./index.css";
import { installNativeShell } from "./lib/nativeShell";

installNativeShell();

createRoot(document.getElementById("root")!).render(<App />);
