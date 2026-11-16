import { MessageSquare, Phone } from "lucide-react";
import { callLink, textLink, whatsAppLink } from "@/lib/reachDriver";

/** WhatsApp's own mark, which is the only thing people look for. */
const WhatsAppMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
    <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.6-.92-2.2-.24-.58-.48-.5-.67-.5h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.07 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.69.25-1.28.17-1.4-.07-.13-.27-.2-.57-.35z" />
    <path d="M12.04 2C6.6 2 2.17 6.43 2.16 11.88c0 1.74.46 3.44 1.32 4.94L2 22l5.33-1.4a9.9 9.9 0 0 0 4.7 1.2h.01c5.44 0 9.87-4.43 9.88-9.88a9.82 9.82 0 0 0-2.89-6.99A9.82 9.82 0 0 0 12.04 2zm0 1.8c2.16 0 4.19.84 5.72 2.37a8.03 8.03 0 0 1 2.37 5.71c0 4.46-3.63 8.08-8.09 8.08a8.1 8.1 0 0 1-4.12-1.13l-.3-.17-3.06.8.82-3-.2-.31a8.03 8.03 0 0 1-1.24-4.3c0-4.46 3.63-8.08 8.1-8.08z" />
  </svg>
);

const pill =
  "inline-flex items-center gap-1.5 px-3 py-2 border text-[11px] tracking-[0.15em] uppercase transition-colors";

interface Props {
  /** The chauffeur's number as Dispatch gives it. */
  mobile: string;
}

/**
 * The three ways a passenger reaches the chauffeur driving them.
 *
 * Calling was the only one, and it is the one a chauffeur at the wheel can
 * least often take. A gate code, a bag left on the seat or a change of door
 * is a sentence, not a conversation, and it can wait at a red light.
 */
const ReachChauffeur = ({ mobile }: Props) => {
  const whatsApp = whatsAppLink(mobile);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <a
        href={callLink(mobile)}
        className={`${pill} border-champagne-muted text-champagne hover:bg-champagne hover:text-charcoal`}
      >
        <Phone className="w-3.5 h-3.5" />
        Call
      </a>
      <a
        href={textLink(mobile)}
        className={`${pill} border-champagne-muted text-champagne hover:bg-champagne hover:text-charcoal`}
      >
        <MessageSquare className="w-3.5 h-3.5" />
        Text
      </a>
      {whatsApp && (
        <a
          href={whatsApp}
          target="_blank"
          rel="noreferrer"
          className={`${pill} border-[#25D366]/60 text-[#25D366] hover:bg-[#25D366] hover:text-charcoal`}
        >
          <WhatsAppMark className="w-3.5 h-3.5" />
          WhatsApp
        </a>
      )}
    </div>
  );
};

export default ReachChauffeur;
