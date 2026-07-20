import { supabase } from "@/integrations/supabase/client";

export interface PhoneChallenge {
  factorId: string;
  challengeId: string;
  phone: string;
}

const maskPhone = (phone: string) =>
  phone.length > 3 ? `••• ••• ${phone.slice(-3)}` : phone;

/**
 * Start SMS verification for the signed-in user. Uses their verified phone
 * factor if one exists, otherwise enrols the phone number on their profile
 * (first sign-in after an invitation). Sends the SMS code.
 */
export const startPhoneChallenge = async (userId: string): Promise<PhoneChallenge> => {
  const { data: factorsData, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) throw listError;

  let factorId: string | null = null;
  let phone = "";

  const verified = factorsData?.phone?.find((f) => f.status === "verified");
  if (verified) {
    factorId = verified.id;
    phone = (verified as { phone?: string }).phone ?? "";
  } else {
    // Clear any stale half-finished enrolments, then enrol the invited number
    for (const stale of factorsData?.all ?? []) {
      if (stale.status === "unverified") {
        await supabase.auth.mfa.unenroll({ factorId: stale.id });
      }
    }

    const { data: prof, error: profError } = await supabase
      .from("profiles")
      .select("phone")
      .eq("id", userId)
      .maybeSingle();
    if (profError) throw profError;
    if (!prof?.phone) {
      throw new Error("No mobile number is registered for your account. Please contact us.");
    }

    const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "phone",
      phone: prof.phone,
    });
    if (enrollError) throw enrollError;
    factorId = enrolled.id;
    phone = prof.phone;
  }

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId,
  });
  if (challengeError) throw challengeError;

  return { factorId, challengeId: challenge.id, phone: maskPhone(phone) };
};

/** Verify the SMS code; on success the session is upgraded to AAL2. */
export const verifyPhoneChallenge = async (
  challenge: PhoneChallenge,
  code: string
): Promise<void> => {
  const { error } = await supabase.auth.mfa.verify({
    factorId: challenge.factorId,
    challengeId: challenge.challengeId,
    code,
  });
  if (error) throw error;
};
