import { useEffect } from "react";
import { Link, Navigate } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AppBadges from "@/components/AppBadges";
import { APP_STORE_URL, PLAY_STORE_URL, isInstalledApp, storeForDevice } from "@/lib/appLinks";

/**
 * The short link we put in texts and emails (apexiavip.com/app). On a phone
 * it goes straight to that phone's store; elsewhere it shows both.
 */
const GetApp = () => {
  const store = storeForDevice();

  useEffect(() => {
    if (isInstalledApp()) return;
    if (store === "ios") window.location.replace(APP_STORE_URL);
    if (store === "android") window.location.replace(PLAY_STORE_URL);
  }, [store]);

  // Already in the app: nothing to install
  if (isInstalledApp()) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center pt-40 md:pt-44 pb-24">
        <div className="container mx-auto px-8 max-w-xl text-center">
          <p className="text-champagne text-xs tracking-[0.4em] uppercase mb-6">Members</p>
          <h1 className="font-display text-4xl md:text-5xl font-light tracking-wider text-foreground mb-6">
            Apexia VIP on your phone
          </h1>
          <p className="text-smoke text-sm leading-relaxed mb-12">
            Book a chauffeur, follow your car on the day, and keep your journeys in one place.
            Sign in with the same mobile number you use on the site.
          </p>
          <AppBadges className="justify-center" />
          <p className="text-smoke text-xs tracking-wider mt-16">
            Prefer the website?{" "}
            <Link to="/login" className="hover:text-foreground transition-colors underline underline-offset-4">
              Member sign in
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default GetApp;
