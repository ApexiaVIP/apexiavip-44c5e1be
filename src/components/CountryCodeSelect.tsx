import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type CountryCode = {
  code: string;
  country: string;
  dial: string;
};

const priorityCodes: CountryCode[] = [
  { code: "GB", country: "United Kingdom", dial: "+44" },
  { code: "US", country: "United States", dial: "+1" },
  { code: "AE", country: "United Arab Emirates", dial: "+971" },
  { code: "FR", country: "France", dial: "+33" },
  { code: "DE", country: "Germany", dial: "+49" },
  { code: "IT", country: "Italy", dial: "+39" },
  { code: "ES", country: "Spain", dial: "+34" },
  { code: "CH", country: "Switzerland", dial: "+41" },
  { code: "NL", country: "Netherlands", dial: "+31" },
  { code: "PT", country: "Portugal", dial: "+351" },
];

const otherCodes: CountryCode[] = [
  { code: "AF", country: "Afghanistan", dial: "+93" },
  { code: "AL", country: "Albania", dial: "+355" },
  { code: "DZ", country: "Algeria", dial: "+213" },
  { code: "AR", country: "Argentina", dial: "+54" },
  { code: "AU", country: "Australia", dial: "+61" },
  { code: "AT", country: "Austria", dial: "+43" },
  { code: "BH", country: "Bahrain", dial: "+973" },
  { code: "BD", country: "Bangladesh", dial: "+880" },
  { code: "BE", country: "Belgium", dial: "+32" },
  { code: "BR", country: "Brazil", dial: "+55" },
  { code: "BG", country: "Bulgaria", dial: "+359" },
  { code: "CA", country: "Canada", dial: "+1" },
  { code: "CL", country: "Chile", dial: "+56" },
  { code: "CN", country: "China", dial: "+86" },
  { code: "CO", country: "Colombia", dial: "+57" },
  { code: "HR", country: "Croatia", dial: "+385" },
  { code: "CY", country: "Cyprus", dial: "+357" },
  { code: "CZ", country: "Czech Republic", dial: "+420" },
  { code: "DK", country: "Denmark", dial: "+45" },
  { code: "EG", country: "Egypt", dial: "+20" },
  { code: "FI", country: "Finland", dial: "+358" },
  { code: "GR", country: "Greece", dial: "+30" },
  { code: "HK", country: "Hong Kong", dial: "+852" },
  { code: "HU", country: "Hungary", dial: "+36" },
  { code: "IN", country: "India", dial: "+91" },
  { code: "ID", country: "Indonesia", dial: "+62" },
  { code: "IE", country: "Ireland", dial: "+353" },
  { code: "IL", country: "Israel", dial: "+972" },
  { code: "JP", country: "Japan", dial: "+81" },
  { code: "JO", country: "Jordan", dial: "+962" },
  { code: "KW", country: "Kuwait", dial: "+965" },
  { code: "LB", country: "Lebanon", dial: "+961" },
  { code: "MY", country: "Malaysia", dial: "+60" },
  { code: "MX", country: "Mexico", dial: "+52" },
  { code: "MC", country: "Monaco", dial: "+377" },
  { code: "MA", country: "Morocco", dial: "+212" },
  { code: "NZ", country: "New Zealand", dial: "+64" },
  { code: "NG", country: "Nigeria", dial: "+234" },
  { code: "NO", country: "Norway", dial: "+47" },
  { code: "OM", country: "Oman", dial: "+968" },
  { code: "PK", country: "Pakistan", dial: "+92" },
  { code: "PH", country: "Philippines", dial: "+63" },
  { code: "PL", country: "Poland", dial: "+48" },
  { code: "QA", country: "Qatar", dial: "+974" },
  { code: "RO", country: "Romania", dial: "+40" },
  { code: "RU", country: "Russia", dial: "+7" },
  { code: "SA", country: "Saudi Arabia", dial: "+966" },
  { code: "SG", country: "Singapore", dial: "+65" },
  { code: "ZA", country: "South Africa", dial: "+27" },
  { code: "KR", country: "South Korea", dial: "+82" },
  { code: "SE", country: "Sweden", dial: "+46" },
  { code: "TH", country: "Thailand", dial: "+66" },
  { code: "TR", country: "Turkey", dial: "+90" },
  { code: "UA", country: "Ukraine", dial: "+380" },
  { code: "VN", country: "Vietnam", dial: "+84" },
].filter((c) => !priorityCodes.some((p) => p.code === c.code));

interface CountryCodeSelectProps {
  value: string;
  onChange: (dial: string) => void;
}

const CountryCodeSelect = ({ value, onChange }: CountryCodeSelectProps) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const select = (dial: string) => {
    onChange(dial);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-1 h-11 px-3 border border-border bg-transparent text-foreground text-sm transition-colors",
          "hover:border-champagne-muted focus:border-champagne-muted focus:outline-none",
          open && "border-champagne-muted"
        )}
      >
        <span className="whitespace-nowrap">{value || "+44"}</span>
        <ChevronDown className="w-3 h-3 opacity-50" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 max-h-60 overflow-y-auto z-50 border border-border bg-popover shadow-lg">
          <div className="py-1">
            {priorityCodes.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => select(c.dial)}
                className={cn(
                  "w-full text-left px-3 py-2 text-sm flex justify-between items-center transition-colors",
                  "hover:bg-muted text-foreground",
                  value === c.dial && "text-champagne"
                )}
              >
                <span>{c.country}</span>
                <span className="text-smoke text-xs">{c.dial}</span>
              </button>
            ))}
          </div>
          <div className="h-px bg-border" />
          <div className="py-1">
            {otherCodes.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => select(c.dial)}
                className={cn(
                  "w-full text-left px-3 py-2 text-sm flex justify-between items-center transition-colors",
                  "hover:bg-muted text-foreground",
                  value === c.dial && "text-champagne"
                )}
              >
                <span>{c.country}</span>
                <span className="text-smoke text-xs">{c.dial}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CountryCodeSelect;
