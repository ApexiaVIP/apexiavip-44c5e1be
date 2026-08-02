import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const h2 = "font-display text-xl font-light tracking-wider text-foreground mt-10 mb-3";
const p = "text-smoke text-sm font-light leading-relaxed mb-3";

const Privacy = () => (
  <div className="min-h-screen bg-background">
    <div className="container mx-auto px-8 py-16 max-w-2xl">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-smoke hover:text-foreground transition-colors duration-500 text-xs tracking-[0.2em] uppercase mb-12"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Site
      </Link>

      <p className="text-champagne text-xs tracking-[0.4em] uppercase mb-3">Apexia VIP</p>
      <h1 className="font-display text-3xl font-light tracking-wider text-foreground mb-6">
        Privacy Policy
      </h1>
      <p className={p}>
        Apexia VIP Ltd ("we", "us") provides members-only executive transport
        through this website and app. This policy explains what personal
        information we hold and how we use it. We handle all information with
        the discretion our service is built on.
      </p>

      <h2 className={h2}>What we collect</h2>
      <p className={p}>
        Membership details you or your inviting member provide: name, mobile
        number, email address, postal address, and an optional profile photo.
        Booking details you submit: journey addresses, dates and times,
        passenger counts and luggage. Security data: one-time sign-in codes
        (stored only in protected form) and records of verified sessions.
      </p>

      <h2 className={h2}>How we use it</h2>
      <p className={p}>
        To operate your membership: signing you in by SMS code, fulfilling and
        managing bookings, showing you your booking history and live journey
        status, and administering family membership. We send SMS messages for
        sign-in codes and membership notifications, and emails for booking
        confirmations and membership information. We do not sell personal
        information or use it for third-party advertising.
      </p>

      <h2 className={h2}>Who processes it for us</h2>
      <p className={p}>
        Trusted service providers process data solely on our instructions:
        cloud hosting and database services, SMS delivery (Twilio), email
        delivery, our booking and dispatch system (to fulfil journeys), and
        map providers (OpenStreetMap and the official UK postcode database)
        for address search and live tracking. Journey details are shared with
        the chauffeur assigned to your booking.
      </p>

      <h2 className={h2}>How long we keep it</h2>
      <p className={p}>
        Membership details are kept while your membership is active. Booking
        records are retained for business and accounting purposes. If your
        account is deleted, your profile and access are removed immediately.
      </p>

      <h2 className={h2}>Your rights</h2>
      <p className={p}>
        Under UK data protection law you may request access to, correction of,
        or deletion of your personal information, and you may object to or
        restrict certain processing. Contact us and we will respond promptly.
      </p>

      <h2 className={h2}>Contact</h2>
      <p className={p}>
        Apexia VIP Ltd &#183;{" "}
        <a href="mailto:info@apexiavip.com" className="text-champagne hover:underline">
          info@apexiavip.com
        </a>
      </p>
      <p className="text-smoke/60 text-xs font-light mt-8">Last updated: 25 July 2026</p>
    </div>
  </div>
);

export default Privacy;
