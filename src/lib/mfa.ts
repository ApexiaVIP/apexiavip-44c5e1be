import { supabase } from "@/integrations/supabase/client";

export interface PhoneChallenge {
  /** How the code was delivered */
  channel: "sms" | "email";
  /** Masked destination the code was sent to, for display */
  destination: string;
}

/** Human sentence describing where the code went, for page subtitles. */
export const describeChallenge = (challenge: PhoneChallenge | null): string =>
  challenge?.channel === "email"
    ? `A 6-digit code has been sent by email to ${challenge.destination}.`
    : `A 6-digit code has been sent by SMS to ${challenge?.destination ?? "your mobile"}.`;

const invokeFn = async (name: string, body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = "Something went wrong";
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) {
        const parsed = await ctx.json();
        if (parsed?.error) message = parsed.error;
      }
    } catch {
      // keep generic message
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
};

const invoke2fa = (body: Record<string, unknown>) => invokeFn("sms-2fa", body);

/** Family member requests (primary members only). */
export const invokeMemberFamily = (body: Record<string, unknown>) =>
  invokeFn("member-family", body);

/**
 * Passwordless sign-in, step 1: send an access code to a registered mobile.
 * Unauthenticated; the number must belong to an active member.
 */
export const startPhoneLogin = async (phone: string): Promise<PhoneChallenge> => {
  const data = await invokeFn("phone-login", { action: "start", phone });
  return {
    channel: data.channel === "email" ? "email" : "sms",
    destination: data.sent_to ?? "your registered contact",
  };
};

/**
 * Passwordless sign-in, step 2: verify the code, establish the session, and
 * mark it code-verified server-side.
 */
export const finishPhoneLogin = async (phone: string, code: string): Promise<void> => {
  const data = await invokeFn("phone-login", { action: "finish", phone, code });

  const { error } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.token_hash,
  });
  if (error) throw new Error("We could not sign you in. Please try again.");

  await invoke2fa({ action: "claim", token: data.claim_token });
};

/** Send a security code to the signed-in member (SMS, or email as interim). */
export const startPhoneChallenge = async (): Promise<PhoneChallenge> => {
  const data = await invoke2fa({ action: "send" });
  return {
    channel: data.channel === "email" ? "email" : "sms",
    destination: data.sent_to ?? "your registered contact",
  };
};

/** Verify the SMS code; on success this session is marked verified server-side. */
export const verifyPhoneChallenge = async (code: string): Promise<void> => {
  await invoke2fa({ action: "verify", code });
};

/** Whether the current session has passed SMS verification. */
export const checkMfaStatus = async (): Promise<boolean> => {
  const data = await invoke2fa({ action: "status" });
  return data.verified === true;
};
