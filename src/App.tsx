import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { AuthProvider } from "@/hooks/useAuth";
import { initialAuthType, initialAuthError } from "@/lib/authHash";
import Index from "./pages/Index";
import VehicleDetail from "./pages/VehicleDetail";
import Login from "./pages/Login";
import Welcome from "./pages/Welcome";
import Profile from "./pages/Profile";
import Bookings from "./pages/Bookings";
import Admin from "./pages/Admin";
import Privacy from "./pages/Privacy";
import McfcPortal from "./pages/McfcPortal";
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
      navigate("/login", { replace: true });
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
            {/* Legacy links from the password era */}
            <Route path="/reset-password" element={<Navigate to="/login" replace />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/bookings" element={<Bookings />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/mcfc" element={<McfcPortal />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
