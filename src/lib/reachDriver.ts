/**
 * Getting hold of the chauffeur.
 *
 * A passenger with a question, a bag left behind, or a gate code does not
 * always want to make a call, and a chauffeur at the wheel cannot always take
 * one. A number from Dispatch is typed however the office typed it, and each
 * of these three ways of using it wants it in a different shape.
 */

/** The number as a phone will dial it, spaces and all being harmless. */
export const callLink = (mobile: string): string => `tel:${mobile.replace(/\s/g, "")}`;

/** The number in a new text message. */
export const textLink = (mobile: string): string => `sms:${mobile.replace(/\s/g, "")}`;

/**
 * WhatsApp wants digits only, with the country code and no plus, so a number
 * written the way it is said in this country has to be translated: 07700
 * 900123 is 447700900123. A number from another country is left as it is,
 * because the leading zero rule is ours.
 */
export const whatsAppNumber = (mobile: string, countryCode = "44"): string | null => {
  const raw = (mobile ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return null;

  // 00 is how the rest of the world writes a plus
  if (digits.startsWith("00")) return digits.slice(2);
  // Already international, written with a plus
  if (raw.startsWith("+")) return digits;
  // Ours, written the way it is said
  if (digits.startsWith("0")) return countryCode + digits.slice(1);
  // Already carries the country code, plus or no plus
  if (digits.startsWith(countryCode)) return digits;
  return countryCode + digits;
};

/** The number in a WhatsApp chat, or nothing if it cannot be made sense of. */
export const whatsAppLink = (mobile: string, countryCode = "44"): string | null => {
  const number = whatsAppNumber(mobile, countryCode);
  return number ? `https://wa.me/${number}` : null;
};
