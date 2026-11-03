import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { asHours, against, monthName } from "@/lib/hours";

interface Row {
  id: string;
  full_name: string | null;
  phone: string | null;
  contractedHours: number | null;
  minutes: number;
  stillOpen: boolean;
  capped: boolean;
  neverClosed: boolean;
}

const call = async (body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let message = "Something went wrong";
    try {
      if (ctx) {
        const parsed = await ctx.json();
        if (parsed?.error) message = parsed.error;
      }
    } catch {
      /* keep the fallback */
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
};

/**
 * Every chauffeur's month, for whoever is handing out the work.
 *
 * The hours have been recorded since the shift clock went in and went only
 * to accounts, so nobody allocating a job could see who was short until the
 * month was over and there was nothing to be done about it.
 *
 * Ordered by who is furthest behind their contract, because that is the
 * order the question gets asked in. Anyone with no contract set sits at the
 * bottom: there is nothing to be behind.
 */
const DriverHours = () => {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["driver-hours-all"],
    queryFn: () => call({ action: "driver_hours" }),
    staleTime: 60_000,
  });

  const setHours = useMutation({
    mutationFn: (v: { user_id: string; hours: number | null }) =>
      call({ action: "set_contracted_hours", ...v }),
    onSuccess: () => {
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["driver-hours-all"] });
    },
    onError: (err: Error) =>
      toast({ title: "Not saved", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="py-8 text-center">
        <Loader2 className="w-5 h-5 animate-spin text-champagne mx-auto" />
      </div>
    );
  }

  const rows = [...((data?.drivers ?? []) as Row[])].sort((a, b) => {
    const left = (r: Row) => against(r.minutes, r.contractedHours).leftMinutes;
    const a1 = left(a);
    const b1 = left(b);
    if (a1 === null && b1 === null) return (a.full_name ?? "").localeCompare(b.full_name ?? "");
    if (a1 === null) return 1;
    if (b1 === null) return -1;
    return b1 - a1;
  });

  const save = (id: string, value: string) => {
    const trimmed = value.trim();
    setHours.mutate({ user_id: id, hours: trimmed === "" ? null : Number(trimmed) });
  };

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-4">
        <h2 className="text-champagne text-xs tracking-[0.4em] uppercase">
          Hours, {monthName((data?.month as string) ?? "")}
        </h2>
        <span className="text-smoke text-xs">{rows.length}</span>
      </div>

      <div className="space-y-2">
        {rows.map((r) => {
          const { leftMinutes, percent } = against(r.minutes, r.contractedHours);
          return (
            <div key={r.id} className="border border-border px-4 py-3 space-y-2">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <p className="text-foreground text-sm">
                  {r.full_name || r.phone}
                  {r.stillOpen && (
                    <span className="text-champagne text-[10px] tracking-[0.15em] uppercase ml-3">
                      On duty
                    </span>
                  )}
                </p>
                <p className="text-smoke text-xs">
                  {asHours(r.minutes)} worked
                  {leftMinutes !== null
                    ? ` of ${r.contractedHours}h, ${asHours(leftMinutes)} left`
                    : ""}
                </p>
              </div>

              {percent !== null && (
                <div className="h-1 w-full bg-border">
                  <div className="h-1 bg-champagne" style={{ width: `${percent}%` }} />
                </div>
              )}

              <div className="flex items-center gap-2">
                <span className="text-smoke text-[10px] tracking-[0.15em] uppercase">
                  Contracted
                </span>
                {editing?.id === r.id ? (
                  <>
                    <Input
                      autoFocus
                      inputMode="numeric"
                      value={editing.value}
                      onChange={(e) => setEditing({ id: r.id, value: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && save(r.id, editing.value)}
                      placeholder="Hours a month"
                      className="h-8 w-32 rounded-none text-sm"
                    />
                    <button
                      type="button"
                      disabled={setHours.isPending}
                      onClick={() => save(r.id, editing.value)}
                      className="text-champagne text-[10px] tracking-[0.15em] uppercase"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="text-smoke text-[10px] tracking-[0.15em] uppercase"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({ id: r.id, value: r.contractedHours?.toString() ?? "" })
                    }
                    className="text-foreground text-sm underline decoration-dotted underline-offset-4"
                  >
                    {r.contractedHours !== null ? `${r.contractedHours}h` : "Not set"}
                  </button>
                )}
              </div>

              {/* Said rather than folded into the figure, because somebody is
                  paid on this */}
              {r.capped && (
                <p className="text-champagne text-[11px]">
                  A shift ran past 14 hours and is capped. Check it before it is paid.
                </p>
              )}
              {r.neverClosed && (
                <p className="text-champagne text-[11px]">
                  A shift was left open and earns nothing. They need to sign off.
                </p>
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <p className="text-smoke text-xs py-6 text-center">No chauffeurs yet.</p>
        )}
      </div>
    </div>
  );
};

export default DriverHours;
