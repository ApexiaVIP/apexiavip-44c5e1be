import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  startPhoneChallenge,
  verifyPhoneChallenge,
  type PhoneChallenge,
} from "@/lib/mfa";

const RESEND_COOLDOWN = 60;

interface SmsCodeStepProps {
  challenge: PhoneChallenge;
  onChallengeChange: (challenge: PhoneChallenge) => void;
  onVerified: () => void;
}

/** 6-digit SMS code entry with resend cooldown; verifies against a phone MFA challenge. */
const SmsCodeStep = ({ challenge, onChallengeChange, onVerified }: SmsCodeStepProps) => {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const verify = async (token: string) => {
    setError(null);
    setSubmitting(true);
    try {
      await verifyPhoneChallenge(token);
      onVerified();
    } catch (err) {
      setCode("");
      setError(
        err instanceof Error && err.message !== "Something went wrong"
          ? err.message
          : "That code is incorrect or has expired. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const fresh = await startPhoneChallenge();
      onChallengeChange(fresh);
      setCooldown(RESEND_COOLDOWN);
    } catch (err) {
      setError(
        err instanceof Error && err.message !== "Something went wrong"
          ? err.message
          : "We could not resend the code. Please wait a moment and try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <InputOTP
          maxLength={6}
          value={code}
          onChange={(value) => {
            setCode(value);
            if (value.length === 6) verify(value);
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
      {error && <p className="text-destructive text-sm text-center">{error}</p>}
      {submitting && <Loader2 className="w-4 h-4 animate-spin mx-auto text-champagne" />}
      <div className="text-center">
        <button
          type="button"
          onClick={resend}
          disabled={cooldown > 0 || submitting}
          className="text-smoke hover:text-foreground transition-colors disabled:opacity-40 text-xs tracking-[0.15em] uppercase"
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend Code"}
        </button>
      </div>
    </div>
  );
};

export default SmsCodeStep;
