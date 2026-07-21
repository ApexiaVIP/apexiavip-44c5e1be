import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { startPhoneChallenge, describeChallenge, type PhoneChallenge } from "@/lib/mfa";
import AuthShell from "@/components/AuthShell";
import SmsCodeStep from "@/components/SmsCodeStep";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const Login = () => {
  const { user, mfaVerified, refreshMfa, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/#contact";

  const [step, setStep] = useState<"credentials" | "code">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<PhoneChallenge | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  // Fully signed in already: leave. Signed in but not SMS-verified: jump to code step.
  useEffect(() => {
    if (loading) return;
    if (user && mfaVerified) {
      navigate(redirectTo, { replace: true });
      return;
    }
    if (user && !mfaVerified && step === "credentials" && !startedRef.current) {
      startedRef.current = true;
      beginChallenge();
    }
  }, [loading, user, mfaVerified]);

  const beginChallenge = async () => {
    // Guard against the session-watcher effect and the submit handler both
    // requesting a code for the same sign-in
    startedRef.current = true;
    setError(null);
    setSubmitting(true);
    try {
      const fresh = await startPhoneChallenge();
      setChallenge(fresh);
      setStep("code");
    } catch (err) {
      setError(
        err instanceof Error && err.message !== "Something went wrong"
          ? err.message
          : "We could not send your verification code. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setSubmitting(false);
      const msg = signInError.message.toLowerCase();
      if (msg.includes("banned")) {
        setError("Your membership is not currently active. Please contact us.");
      } else {
        setError("Incorrect email or password.");
      }
      return;
    }
    await beginChallenge();
  };

  return (
    <AuthShell
      title={step === "credentials" ? "Sign In" : "Verify It's You"}
      subtitle={
        step === "credentials"
          ? "Enter your membership email and password. We will then send you a security code."
          : describeChallenge(challenge)
      }
    >
      {step === "credentials" ? (
        <form onSubmit={signIn} className="space-y-4">
          <Input
            type="email"
            autoComplete="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Button
            type="submit"
            disabled={submitting || !email.trim() || !password}
            className="w-full tracking-[0.2em] uppercase"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue"}
          </Button>
          <div className="pt-2">
            <Link
              to="/reset-password"
              className="text-smoke hover:text-foreground transition-colors text-xs tracking-[0.15em] uppercase"
            >
              Forgotten Password
            </Link>
          </div>
        </form>
      ) : user && challenge ? (
        <SmsCodeStep
          challenge={challenge}
          onChallengeChange={setChallenge}
          onVerified={async () => {
            await refreshMfa();
            navigate(redirectTo, { replace: true });
          }}
        />
      ) : (
        <Loader2 className="w-5 h-5 animate-spin mx-auto text-champagne" />
      )}
    </AuthShell>
  );
};

export default Login;
