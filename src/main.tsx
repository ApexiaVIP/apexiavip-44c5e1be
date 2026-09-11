import "./lib/authHash"; // must run before the Supabase client consumes the URL hash
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installNativeShell } from "./lib/nativeShell";

installNativeShell();

createRoot(document.getElementById("root")!).render(<App />);
