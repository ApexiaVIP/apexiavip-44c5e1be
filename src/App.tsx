import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { AuthProvider } from "@/hooks/useAuth";
import { initialAuthType, initialAuthError } from "@/lib/authHash";
import Index from "./pages/Index";
import VehicleDetail from "./pages/VehicleDetail";
import Login from "./pages/Login";
import Welcome from "./pages/Welcome";
import ResetPassword from "./pages/ResetPassword";
import Admin from "./pages/Admin";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

// Invite/recovery email links land on the site root (Lovable Cloud manages the
// redirect allowlist); route them to the right screen based on the link type.
const AuthLinkRedirect = () => {
  const navigate = useNavigate();
  useEffect(() => {
    if (initialAuthType === "invite") {
      navigate("/welcome", { replace: true });
    } else if (initialAuthType === "recovery") {
      navigate("/reset-password", { replace: true });
    } else if (initialAuthError) {
      // Expired or invalid link: /welcome explains and points to reset
      navigate("/welcome", { replace: true });
    }
  }, [navigate]);
  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AuthLinkRedirect />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/fleet/:slug" element={<VehicleDetail />} />
            <Route path="/login" element={<Login />} />
            <Route path="/welcome" element={<Welcome />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/admin" element={<Admin />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
