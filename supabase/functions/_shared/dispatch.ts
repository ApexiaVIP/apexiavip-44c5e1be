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
