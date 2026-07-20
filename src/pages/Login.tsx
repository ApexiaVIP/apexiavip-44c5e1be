import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import CountryCodeSelect from "@/components/CountryCodeSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import apexiaLogo from "@/assets/apexia-logo.jpg";

const RESEND_COOLDOWN = 60;

const normalisePhone = (countryCode: string, phone: string) => {
  const digits = phone.replace(/[\s\-()]/g, "").replace(/^0+/, "");
  return `${countryCode}${digits}`;
};

const Login = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/#contact";

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [countryCode, setCountryCode] = useState("+44");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!loading && user) navigate(redirectTo, { replace: true });
  }, [loading, user, navigate, redirectTo]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const fullPhone = normalisePhone(countryCode, phone);

  const sendCode = async () => {
    setError(null);
    if (!/^\+[1-9]\d{7,14}$/.test(fullPhone)) {
      setError("Please enter a valid phone number.");
      return;
    }
    setSubmitting(true);
    const { error: otpError } = await supabase.auth.signInWithOtp({
      phone: fullPhone,
      options: { shouldCreateUser: false },
    });
    setSubmitting(false);

    if (otpError) {
      const msg = otpError.message.toLowerCase();
      if (msg.includes("signup") || msg.includes("not allowed") || msg.includes("not found")) {
        setError("This number is not registered. Access is by invitation only.");
      } else if (msg.includes("rate") || msg.includes("security purposes")) {
        setError("Too many attempts. Please wait a moment and try again.");
      } else {
        setError("We could not send a code. Please try again.");
      }
      return;
    }
    setStep("code");
    setCode("");
    setCooldown(RESEND_COOLDOWN);
  };

  const verifyCode = async (token: string) => {
    setError(null);
    setSubmitting(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone: fullPhone,
      token,
      type: "sms",
    });
    setSubmitting(false);

    if (verifyError) {
      setCode("");
      setError("That code is incorrect or has expired. Please try again.");
      return;
    }
    navigate(redirectTo, { replace: true });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-8">
      <Link
        to="/"
        className="absolute top-8 left-8 flex items-center gap-2 text-smoke hover:text-foreground transition-colors duration-500 text-xs tracking-[0.2em] uppercase"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </Link>

      <div className="w-full max-w-md text-center">
        <img src={apexiaLogo} alt="Apexia VIP" className="h-24 w-auto mx-auto mb-10" />
        <p className="text-champagne text-xs tracking-[0.4em] uppercase mb-4">
          Members Only
        </p>
        <h1 className="font-display text-3xl font-light tracking-wider text-foreground mb-4">
          {step === "phone" ? "Sign In" : "Enter Your Code"}
        </h1>
        <p className="text-smoke text-sm font-light leading-relaxed mb-10">
          {step === "phone"
            ? "Enter the mobile number registered with your membership and we will send you a secure access code."
            : `A 6-digit code has been sent by SMS to ${fullPhone}.`}
        </p>

        {step === "phone" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendCode();
            }}
            className="space-y-6"
          >
            <div className="flex gap-3">
              <CountryCodeSelect value={countryCode} onChange={setCountryCode} />
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="7700 900123"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="flex-1"
              />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button
              type="submit"
              disabled={submitting || !phone.trim()}
              className="w-full tracking-[0.2em] uppercase"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send Code"}
            </Button>
          </form>
        ) : (
          <div className="space-y-6">
            <div className="flex justify-center">
              <InputOTP
                maxLength={6}
                value={code}
                onChange={(value) => {
                  setCode(value);
                  if (value.length === 6) verifyCode(value);
                }}
                disabled={submitting}
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
            {submitting && (
              <Loader2 className="w-4 h-4 animate-spin mx-auto text-champagne" />
            )}
            <div className="flex items-center justify-center gap-6 text-xs tracking-[0.15em] uppercase">
              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setError(null);
                }}
                className="text-smoke hover:text-foreground transition-colors"
              >
                Change Number
              </button>
              <button
                type="button"
                onClick={sendCode}
                disabled={cooldown > 0 || submitting}
                className="text-smoke hover:text-foreground transition-colors disabled:opacity-40"
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend Code"}
              </button>
            </div>
          </div>
        )}

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
};

export default Login;
