/**
 * How we sign in to Dispatch's booking transfer API.
 *
 * Dever changed the authorisation in October 2026: the password is now a
 * transfer API key issued to each Dispatch company, instead of the transfer
 * reference. The reference still goes in the URL, which was the point of the
 * change: the same string was being used to address the company and to prove
 * who was calling.
 *
 * Every call we make is addressed to our own Dispatch company, so the
 * password is our own key in all of them.
 *
 * The old reference keeps working for now, by Dever's own account, so the key
 * is preferred when it is set and the reference is used when it is not. That
 * way the changeover is one secret being added rather than a deployment that
 * has to land at the same moment.
 */
export const transferAuth = (apiKey?: string | null, reference?: string | null) => {
  const password = (apiKey ?? "").trim() || (reference ?? "").trim();
  return btoa(`TRANSFERAPIUSER:${password}`);
};

/** True once the key is in place, for anything that wants to say so */
export const usingTransferKey = (apiKey?: string | null) => !!(apiKey ?? "").trim();

/**
 * Where Dispatch is.
 *
 * Dever's address was written into seven places across five functions, so
 * pointing the platform at anything else, a replacement desk or a copy to
 * test against, meant editing and deploying five functions rather than
 * changing a setting. DISPATCH_BASE_URL is that setting. Left unset it is
 * Dever, which is where it has always pointed, so nothing moves until
 * somebody decides it should.
 */
const dispatchBase = () => {
  // Blank, not just unset. A secret can be created with nothing in it, and an
  // empty base would quietly build a relative address that reaches nothing.
  const chosen = (Deno.env.get("DISPATCH_BASE_URL") ?? "").trim();
  return (chosen || "https://dispatch.deversoftware.com").replace(/\/+$/, "");
};

const transferUrl = (reference: string, asking: string) =>
  `${dispatchBase()}/Dispatch/Transfer/?TransferToReference=${encodeURIComponent(reference)}&${asking}`;

/** Sending a booking over, whether it is new or an amendment. */
export const bookingTransferUrl = (reference: string) =>
  transferUrl(reference, "BookedBy=Website");

/** Asking what has become of bookings we have already sent. */
export const statusTransferUrl = (reference: string) =>
  transferUrl(reference, "CheckBookingStatus=true");
