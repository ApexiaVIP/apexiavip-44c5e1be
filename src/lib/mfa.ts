import { supabase } from "@/integrations/supabase/client";

export interface PhoneChallenge {
  /** Masked phone number the code was sent to, for display */
  phone: string;
}

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

/** Send an SMS code to the signed-in member's registered mobile. */
export const startPhoneChallenge = async (): Promise<PhoneChallenge> => {
  const data = await invoke2fa({ action: "send" });
  return { phone: data.phone ?? "your mobile" };
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
