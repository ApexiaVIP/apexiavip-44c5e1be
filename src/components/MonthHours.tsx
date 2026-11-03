import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { asHours, against, monthName } from "@/lib/hours";

interface Month {
  month: string;
  minutes: number;
  contractedHours: number | null;
  stillOpen: boolean;
  capped: boolean;
  neverClosed: boolean;
}

/**
 * A chauffeur's own month, and how much of it is left to work.
 *
 * The hours have been recorded since the shift clock went in and went only
 * to accounts. The chauffeurs asked to see their own, and the office asked
 * to see everybody's when allocating, so that nobody reaches the end of a
 * month short of their contract with nothing to be done about it.
 */
const MonthHours = () => {
  const { data } = useQuery({
    queryKey: ["driver-hours"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("driver", {
        body: { action: "hours" },
      });
      if (error) throw error;
      return data as Month;
    },
    // The clock only moves when a shift opens or closes, so this is not a
    // number worth asking for every few seconds
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (!data) return null;

  const worked = data.minutes;
  const contracted = data.contractedHours;
  const { leftMinutes, percent } = against(worked, contracted);

  return (
    <div className="border border-border p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[10px] tracking-[0.2em] uppercase text-smoke flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-champagne" />
          {monthName(data.month)}
        </p>
        {data.stillOpen && (
          <span className="text-[10px] tracking-[0.15em] uppercase text-champagne">
            On duty now
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-4 flex-wrap">
        <p className="text-foreground text-2xl font-light">{asHours(worked)}</p>
        {leftMinutes !== null ? (
          <p className="text-smoke text-xs">
            worked of {contracted}h, {asHours(leftMinutes)} left
          </p>
        ) : (
          <p className="text-smoke text-xs">worked. No contracted hours set yet.</p>
        )}
      </div>

      {percent !== null && (
        <div className="h-1 w-full bg-border">
          <div className="h-1 bg-champagne" style={{ width: `${percent}%` }} />
        </div>
      )}

      {/* Said plainly rather than quietly folded into the figure, because
          somebody is paid on this */}
      {data.capped && (
        <p className="text-champagne text-[11px] leading-relaxed">
          A shift ran past 14 hours and has been capped. Check it with the office before
          it is paid.
        </p>
      )}
      {data.neverClosed && (
        <p className="text-champagne text-[11px] leading-relaxed">
          A shift was left open and earns nothing. Sign off at the end of a day so your
          hours count.
        </p>
      )}
    </div>
  );
};

export default MonthHours;
