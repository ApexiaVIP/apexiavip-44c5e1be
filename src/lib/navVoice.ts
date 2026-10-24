/**
 * The voice that reads the turns out.
 *
 * A chauffeur cannot look at a screen on the Mancunian Way, so the turns are
 * spoken. The phone does the speaking itself, which costs nothing and works
 * with no signal.
 */

const REMEMBERED = "apx.drive.voice";

/** Whether the chauffeur has the voice switched on. Kept between jobs. */
export const voiceWanted = (): boolean => {
  try {
    return localStorage.getItem(REMEMBERED) !== "off";
  } catch {
    // A phone that will not keep settings still gets a voice
    return true;
  }
};

export const rememberVoice = (wanted: boolean): void => {
  try {
    localStorage.setItem(REMEMBERED, wanted ? "on" : "off");
  } catch {
    /* nothing to be done, and nothing worth saying about it */
  }
};

const synth = (): SpeechSynthesis | null =>
  typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;

export const canSpeak = (): boolean => !!synth();

let chosen: SpeechSynthesisVoice | null = null;

/**
 * A British voice, where the phone has one.
 *
 * An American voice saying Mancunian road names is a distraction, and
 * "roundabout" in particular comes out wrong.
 */
const britishVoice = (): SpeechSynthesisVoice | null => {
  const speech = synth();
  if (!speech) return null;
  if (chosen) return chosen;
  const voices = speech.getVoices?.() ?? [];
  chosen =
    voices.find((v) => v.lang === "en-GB" && v.localService) ??
    voices.find((v) => v.lang === "en-GB") ??
    voices.find((v) => v.lang?.startsWith("en")) ??
    null;
  return chosen;
};

/**
 * Say something.
 *
 * An urgent instruction is the one at the junction itself, and it cuts off
 * whatever is still being said, because by the time a long sentence about the
 * next roundabout has finished the turn has been missed.
 */
export const say = (words: string, { urgent = false }: { urgent?: boolean } = {}): void => {
  const speech = synth();
  if (!speech || !words) return;
  try {
    if (urgent) speech.cancel();
    const utterance = new SpeechSynthesisUtterance(words);
    utterance.lang = "en-GB";
    const voice = britishVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 1;
    speech.speak(utterance);
  } catch {
    // Some phones refuse to speak until the screen has been touched; losing
    // an announcement is not worth interrupting a drive over
  }
};

export const hush = (): void => {
  try {
    synth()?.cancel();
  } catch {
    /* already quiet */
  }
};

/**
 * Unlock the voice on a phone that will only speak after a touch.
 *
 * Called from the tap that starts the drive, which is the gesture iOS wants
 * before it will let a page speak at all.
 */
export const wakeVoice = (): void => {
  const speech = synth();
  if (!speech) return;
  try {
    // Loading the voice list here means the right one is ready by the first turn
    speech.getVoices?.();
    const nudge = new SpeechSynthesisUtterance(" ");
    nudge.volume = 0;
    speech.speak(nudge);
  } catch {
    /* the voice simply will not work on this phone */
  }
};
