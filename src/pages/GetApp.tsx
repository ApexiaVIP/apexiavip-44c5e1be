import { useEffect } from "react";
import { Link, Navigate } from "react-router-dom";
import { CalendarClock, MapPin, Smartphone, History } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AppBadges from "@/components/AppBadges";
import { APP_STORE_URL, PLAY_STORE_URL, isInstalledApp, storeForDevice } from "@/lib/appLinks";
import appScreen from "@/assets/app-screen.jpg";

const features = [
  {
    icon: CalendarClock,
    title: "Book in moments",
    text: "Choose your car, set the time and route, and your request goes straight to our operations team.",
  },
  {
    icon: MapPin,
    title: "Follow your chauffeur live",
    text: "On the day, see your car on the map, with your driver's name and vehicle the moment they are assigned.",
  },
  {
    icon: History,
    title: "Every journey in one place",
    text: "Upcoming and past bookings, with amendments and cancellations handled from your phone.",
  },
  {
    icon: Smartphone,
    title: "No password to remember",
    text: "Sign in with the mobile number on your membership. We text you a secure code, nothing else to keep.",
  },
];

/**
 * The short link we put in texts and emails (apexiavip.com/app). On a phone
 * it goes straight to that phone's store; elsewhere it makes the case.
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
      <main className="flex-1 pt-40 md:pt-48 pb-24 overflow-hidden">
        <div className="container mx-auto px-8">
          <div className="grid lg:grid-cols-2 gap-16 lg:gap-24 items-center">
            {/* Copy */}
            <div className="max-w-xl">
              <p className="text-champagne text-xs tracking-[0.4em] uppercase mb-6 animate-fade-in-slow">
                Members
              </p>
              <h1 className="font-display text-5xl md:text-6xl font-light tracking-wider text-foreground leading-tight mb-6 animate-fade-in-slow">
                Apexia VIP,
                <br />
                in your pocket
              </h1>
              <div className="h-px w-24 my-8 bg-champagne-muted" />
              <p className="text-smoke text-sm md:text-base leading-relaxed mb-12">
                The same discreet service, now on iPhone and Android. Book a chauffeur, watch your
                car arrive, and keep every journey to hand.
              </p>

              <AppBadges size="lg" className="mb-16 justify-start" />

              <ul className="space-y-8">
                {features.map(({ icon: Icon, title, text }) => (
                  <li key={title} className="flex gap-5">
                    <span className="mt-0.5 flex-none w-9 h-9 border border-champagne-muted flex items-center justify-center text-champagne">
                      <Icon className="w-4 h-4" strokeWidth={1.5} />
                    </span>
                    <div>
                      <p className="text-foreground text-sm tracking-[0.15em] uppercase mb-1">{title}</p>
                      <p className="text-smoke text-sm leading-relaxed">{text}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <p className="text-smoke text-xs tracking-wider mt-16">
                Prefer the website?{" "}
                <Link
                  to="/login"
                  className="hover:text-foreground transition-colors underline underline-offset-4"
                >
                  Member sign in
                </Link>
              </p>
            </div>

            {/* Phone */}
            <div className="relative flex justify-center lg:justify-end animate-fade-in">
              <div
                aria-hidden="true"
                className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,_hsl(var(--champagne)/0.10),_transparent_60%)]"
              />
              <div className="relative w-[280px] md:w-[320px] rounded-[3rem] border border-champagne-muted bg-black p-3 shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]">
                <div className="absolute left-1/2 top-3 -translate-x-1/2 w-24 h-6 rounded-full bg-black z-10" />
                <img
                  src={appScreen}
                  alt="The Apexia VIP app: choosing a vehicle for a booking"
                  className="w-full rounded-[2.4rem] block"
                  width={552}
                  height={1200}
                />
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default GetApp;
