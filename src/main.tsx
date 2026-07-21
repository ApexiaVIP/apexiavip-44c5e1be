import "./lib/authHash"; // must run before the Supabase client consumes the URL hash
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
