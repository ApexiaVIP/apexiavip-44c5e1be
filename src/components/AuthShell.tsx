import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import apexiaLogo from "@/assets/apexia-logo.jpg";

interface AuthShellProps {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}

/** Shared full-page layout for the members auth screens. */
const AuthShell = ({ eyebrow = "Members Only", title, subtitle, children }: AuthShellProps) => (
  <div className="min-h-screen bg-background flex flex-col items-center justify-center px-8 py-16">
    <Link
      to="/"
      className="absolute top-8 left-8 flex items-center gap-2 text-smoke hover:text-foreground transition-colors duration-500 text-xs tracking-[0.2em] uppercase"
    >
      <ArrowLeft className="w-4 h-4" />
      Back
    </Link>

    <div className="w-full max-w-md text-center">
      <img src={apexiaLogo} alt="Apexia VIP" className="h-24 w-auto mx-auto mb-10" />
      <p className="text-champagne text-xs tracking-[0.4em] uppercase mb-4">{eyebrow}</p>
      <h1 className="font-display text-3xl font-light tracking-wider text-foreground mb-4">
        {title}
      </h1>
      {subtitle && (
        <p className="text-smoke text-sm font-light leading-relaxed mb-10">{subtitle}</p>
      )}
      {children}
      <p className="text-smoke/60 text-xs font-light mt-12 leading-relaxed">
        Apexia VIP is an invitation-only service.
        <br />
        To enquire about membership, please{" "}
        <a href="mailto:info@apexiavip.com" className="text-champagne hover:underline">
          contact us
        </a>
        .
      </p>
    </div>
  </div>
);

export default AuthShell;
