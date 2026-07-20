import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { startPhoneChallenge, type PhoneChallenge } from "@/lib/mfa";
import AuthShell from "@/components/AuthShell";
import SmsCodeStep from "@/components/SmsCodeStep";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Step = "request" | "sent" | "code" | "update";

const ResetPassword = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [challenge, setChallenge] = useState<PhoneChallenge | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  // Arriving via a recovery link signs the user in; decide whether SMS is needed first
  useEffect(() => {
    if (loading || !user || startedRef.current) return;
    startedRef.current = true;
    (async () => {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (data?.currentLevel !== "aal2" && data?.nextLevel === "aal2") {
        try {
          const fresh = await startPhoneChallenge(user.id);
          setChallenge(fresh);
          setStep("code");
        } catch {
          setError("We could not send your verification code. Please try again.");
          setStep("code");
        }
      } else {
        setStep("update");
      }
    })();
  }, [loading, user]);

  const requestLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    // Always report success so the form can't be used to probe member emails
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    setStep("sent");
  };

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
    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      setError("We could not save your password. Please try again.");
      return;
    }
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    navigate(data?.currentLevel === "aal2" ? "/#contact" : "/login", { replace: true });
  };

  const subtitles: Record<Step, string> = {
    request:
      "Enter your membership email and we will send you a secure link to reset your password.",
    sent: "If that email is registered with a membership, a reset link is on its way. The link is valid for a limited time.",
    code: `A 6-digit code has been sent by SMS to ${challenge?.phone ?? "your registered mobile"}.`,
    update: "Choose a new password for your membership account.",
  };
  const titles: Record<Step, string> = {
    request: "Reset Password",
    sent: "Check Your Email",
    code: "Verify It's You",
    update: "New Password",
  };

  return (
    <AuthShell title={titles[step]} subtitle={subtitles[step]}>
      {step === "request" && (
        <form onSubmit={requestLink} className="space-y-4">
          <Input
            type="email"
            autoComplete="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Button
            type="submit"
            disabled={submitting || !email.trim()}
            className="w-full tracking-[0.2em] uppercase"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send Reset Link"}
          </Button>
        </form>
      )}

      {step === "code" &&
        (user && challenge ? (
          <SmsCodeStep
            userId={user.id}
            challenge={challenge}
            onChallengeChange={setChallenge}
            onVerified={() => setStep("update")}
          />
        ) : (
          <>
            {error && <p className="text-destructive text-sm mb-4">{error}</p>}
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-champagne" />
          </>
        ))}

      {step === "update" && (
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
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Password"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
};

export default ResetPassword;
