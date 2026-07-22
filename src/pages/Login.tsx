import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  startPhoneChallenge,
  startPhoneLogin,
  finishPhoneLogin,
  describeChallenge,
  type PhoneChallenge,
} from "@/lib/mfa";
import AuthShell from "@/components/AuthShell";
import SmsCodeStep from "@/components/SmsCodeStep";
import CountryCodeSelect from "@/components/CountryCodeSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

const RESEND_COOLDOWN = 60;

const normalisePhone = (countryCode: string, phone: string) => {
  const digits = phone.replace(/[\s\-()]/g, "").replace(/^0+/, "");
  return `${countryCode}${digits}`;
};

const surfaceError = (err: unknown, fallback: string) =>
  err instanceof Error && err.message !== "Something went wrong" ? err.message : fallback;

const Login = () => {
  const { user, mfaVerified, refreshMfa, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/#contact";

  // "fresh": passwordless phone sign-in. "session": an existing signed-in
  // session that just needs code re-verification (e.g. after an admin 2FA reset).
  const [mode, setMode] = useState<"fresh" | "session">("fresh");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [countryCode, setCountryCode] = useState("+44");
  const [phone, setPhone] = useState("");
  const [challenge, setChallenge] = useState<PhoneChallenge | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const startedRef = useRef(false);

  const fullPhone = normalisePhone(countryCode, phone);

  useEffect(() => {
    if (loading) return;
    if (user && mfaVerified) {
      navigate(redirectTo, { replace: true });
      return;
    }
    // Only auto-start a challenge for an already-signed-in visitor landing on
    // the phone step; never mid fresh sign-in (the session appears a moment
    // before its verification stamp, which must not trigger a second code)
    if (user && !mfaVerified && step === "phone" && !startedRef.current) {
      startedRef.current = true;
      (async () => {
        setSubmitting(true);
        try {
          const fresh = await startPhoneChallenge();
          setChallenge(fresh);
          setMode("session");
          setStep("code");
        } catch (err) {
          setError(surfaceError(err, "We could not send your access code. Please try again."));
        } finally {
          setSubmitting(false);
        }
      })();
    }
  }, [loading, user, mfaVerified]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async () => {
    setError(null);
    if (!/^\+[1-9]\d{7,14}$/.test(fullPhone)) {
      setError("Please enter a valid phone number.");
      return;
    }
    setSubmitting(true);
    startedRef.current = true;
    try {
      const fresh = await startPhoneLogin(fullPhone);
      setChallenge(fresh);
      setStep("code");
      setCode("");
      setCooldown(RESEND_COOLDOWN);
    } catch (err) {
      setError(surfaceError(err, "We could not send your access code. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const verifyFresh = async (token: string) => {
    setError(null);
    setSubmitting(true);
    try {
      await finishPhoneLogin(fullPhone, token);
      await refreshMfa();
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setCode("");
      setError(surfaceError(err, "That code is incorrect or has expired. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title={step === "phone" ? "Sign In" : "Enter Your Code"}
      subtitle={
        step === "phone"
          ? "Enter the mobile number registered with your membership and we will send you a secure access code. No password needed."
          : describeChallenge(challenge)
      }
    >
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
      ) : mode === "session" && user && challenge ? (
        <SmsCodeStep
          challenge={challenge}
          onChallengeChange={setChallenge}
          onVerified={async () => {
            await refreshMfa();
            navigate(redirectTo, { replace: true });
          }}
        />
      ) : (
        <div className="space-y-6">
          <div className="flex justify-center">
            <InputOTP
              maxLength={6}
              value={code}
              onChange={(value) => {
                setCode(value);
                if (value.length === 6) verifyFresh(value);
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
    </AuthShell>
  );
};

export default Login;
