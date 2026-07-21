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

const invoke2fa = async (body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke("sms-2fa", { body });
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
