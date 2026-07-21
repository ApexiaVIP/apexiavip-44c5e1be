import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { startPhoneChallenge, describeChallenge, type PhoneChallenge } from "@/lib/mfa";
import AuthShell from "@/components/AuthShell";
import SmsCodeStep from "@/components/SmsCodeStep";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const Welcome = () => {
  const { user, refreshMfa, loading } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<"password" | "code">("password");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [challenge, setChallenge] = useState<PhoneChallenge | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Your password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    if (!user) return;

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setSubmitting(false);
      setError("We could not save your password. Please try again.");
      return;
    }
    try {
      const fresh = await startPhoneChallenge();
      setChallenge(fresh);
      setStep("code");
    } catch {
      setError("Password saved, but we could not send your verification code. Please sign in.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <AuthShell title="Welcome">
        <Loader2 className="w-5 h-5 animate-spin mx-auto text-champagne" />
      </AuthShell>
    );
  }

  if (!user) {
    return (
      <AuthShell
        title="Invitation Expired"
        subtitle="This invitation link is invalid or has expired. You can request a fresh link using the password reset below, or contact us."
      >
        <Link
          to="/reset-password"
          className="inline-block border border-champagne text-champagne hover:bg-champagne hover:text-background transition-colors duration-500 text-xs tracking-[0.2em] uppercase px-10 py-4"
        >
          Request a New Link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Welcome to Apexia VIP"
      title={step === "password" ? "Create Your Password" : "Verify It's You"}
      subtitle={
        step === "password"
          ? "Choose a password for your membership account. We will then send you a security code to confirm your identity."
          : describeChallenge(challenge)
      }
    >
      {step === "password" ? (
        <form onSubmit={savePassword} className="space-y-4">
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="Confirm password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Button
            type="submit"
            disabled={submitting || !password || !confirm}
            className="w-full tracking-[0.2em] uppercase"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue"}
          </Button>
        </form>
      ) : challenge ? (
        <SmsCodeStep
          challenge={challenge}
          onChallengeChange={setChallenge}
          onVerified={async () => {
            await refreshMfa();
            navigate("/#contact", { replace: true });
          }}
        />
      ) : (
        <Loader2 className="w-5 h-5 animate-spin mx-auto text-champagne" />
      )}
    </AuthShell>
  );
};

export default Welcome;
