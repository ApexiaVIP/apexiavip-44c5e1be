import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  Loader2,
  MapPin,
  ArrowRight,
  Clock,
  UserMinus,
  UserPlus,
  Car,
  CheckCheck,
  PauseCircle,
  Navigation,
  Flag,
} from "lucide-react";
import Header from "@/components/Header";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { isInstalledApp } from "@/lib/appLinks";
import { currentPlace, followPosition } from "@/lib/whereAmI";
import { splitJobs } from "@/lib/driverQueue";

type Step = "en_route" | "arrived" | "pob" | "waiting" | "clear";

/** Matches the window the server allows; after this the office has the job. */
const UNDO_CLEAR_MINUTES = 30;

interface Job {
  reference: string;
  name: string;
  vehicle: string;
  collection_at: string | null;
  travel_date: string;
  pickup: { line1?: string; town?: string; postcode?: string } | null;
  dropoff: { line1?: string; town?: string; postcode?: string } | null;
  journey_type: string | null;
  as_directed_hours: number | null;
  notes: string | null;
  children: { age: number }[] | null;
  passengers: number | null;
  corporate: string | null;
  driver_status: Step | null;
  driver_status_at: string | null;
  /** Set once the office has been sent this job, after which it cannot be undone */
  job_report_sent_at: string | null;
  dispatchStatus: string | null;
  vehicleRegistration: string;
}

interface Waypoint {
  id: string;
  booking_reference: string;
  kind: Step | "set_down" | "collected" | "note";
  place: string;
  note: string;
  recorded_at: string;
}

const callDriver = async (body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke("driver", { body });
  if (error) {
    let message = "Something went wrong";
    try {
      const ctx = (error as { context?: Response }).context;
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

const ukTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/London",
      })
    : "";

const ukDay = (iso: string | null) =>
  new Date(iso ?? Date.now()).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  });

const addressLine = (a: Job["pickup"]) => [a?.line1, a?.town].filter(Boolean).join(", ") || "";

const stepLabel: Record<string, string> = {
  en_route: "En route",
  arrived: "Arrived",
  pob: "Passenger on board",
  waiting: "Waiting",
  clear: "Cleared",
  set_down: "Set down",
  collected: "Collected",
  note: "Note",
};

/** Where a job has got to, in the chauffeur's own words. */
const whereItIs = (status: Step | null) =>
  status ? stepLabel[status] : "Not started";

const Driver = () => {
  const { user, profile, mfaVerified, mfaResolved, loading, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [waitFor, setWaitFor] = useState<string | null>(null);
  const [clearFor, setClearFor] = useState<string | null>(null);
  const [clearNotes, setClearNotes] = useState("");
  const [waitPlace, setWaitPlace] = useState("");
  const [waitFix, setWaitFix] = useState<{ lat?: number; lng?: number }>({});
  const [locating, setLocating] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);
  // Jobs cleared in this session. A refresh that has not caught up yet must
  // never put a finished job back in the chauffeur's hands.
  const [clearedHere, setClearedHere] = useState<string[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["driver-day"],
    queryFn: () => callDriver({ action: "today" }),
    enabled: !!user && mfaVerified,
    refetchInterval: 60_000,
    // A job must never blink out of existence while the screen refreshes
    placeholderData: keepPreviousData,
  });

  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => callDriver(body),
    // Show the next step straight away; the refetch only confirms it
    onMutate: async (body) => {
      if (body.action !== "progress") return;
      await queryClient.cancelQueries({ queryKey: ["driver-day"] });
      const previous = queryClient.getQueryData(["driver-day"]);
      queryClient.setQueryData(["driver-day"], (old: { jobs?: Job[] } | undefined) => {
        if (!old?.jobs) return old;
        return {
          ...old,
          jobs: old.jobs.map((j) =>
            j.reference === body.reference ? { ...j, driver_status: body.kind as Step } : j
          ),
        };
      });
      return { previous };
    },
    onSuccess: (_data, body) => {
      if (body.action === "progress" && body.kind === "clear") {
        setClearedHere((refs) =>
          refs.includes(body.reference as string) ? refs : [...refs, body.reference as string]
        );
      }
      if (body.action === "undo_clear") {
        setClearedHere((refs) => refs.filter((r) => r !== body.reference));
        toast({ title: "Clear taken back", description: "The job is back in your hands." });
      }
    },
    onError: (err: Error, _body, context) => {
      if (context?.previous) queryClient.setQueryData(["driver-day"], context.previous);
      toast({ title: "Not saved", description: err.message, variant: "destructive" });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["driver-day"] }),
  });

  // One job in hand, the rest waiting, the finished ones out of the way. A job
  // cleared here stays cleared even if a refresh has not caught up.
  const { current, queue, done } = splitJobs((data?.jobs ?? []) as Job[], clearedHere);

  // While a job is actually running, the phone reports where the car is, so
  // the passenger sees it move instead of watching a pin that never changes.
  // Nothing is reported before the chauffeur sets off or after they clear.
  const reportingFor =
    current && current.driver_status && current.driver_status !== "clear"
      ? current.reference
      : null;
  useEffect(() => {
    if (!reportingFor) return;
    return followPosition((lat, lng) => {
      void supabase.functions.invoke("driver", {
        body: { action: "position", reference: reportingFor, lat, lng },
      });
    });
  }, [reportingFor]);

  if (loading || (user && !mfaResolved)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-champagne" />
      </div>
    );
  }
  if (!user || !mfaVerified) return <Navigate to="/login" state={{ from: "/driver" }} replace />;
  if (profile && (profile as { is_driver?: boolean }).is_driver !== true) {
    return <Navigate to="/" replace />;
  }

  const shift = data?.shift as { id: string; started_at: string } | null | undefined;
  const allJobs = (data?.jobs ?? []) as Job[];
  const waypoints = (data?.waypoints ?? []) as Waypoint[];

  const onShift = !!shift;
  const next = queue[0] ?? null;

  const step = (job: Job, kind: Step, place = "", fix: { lat?: number; lng?: number } = {}) =>
    act.mutate({ action: "progress", reference: job.reference, kind, place, ...fix });

  /** Fetch a position, then let the chauffeur correct it before it is saved. */
  const openWait = async (job: Job) => {
    setWaitFor(job.reference);
    setWaitPlace("");
    setWaitFix({});
    setLocating(true);
    const found = await currentPlace();
    setLocating(false);
    setWaitPlace(found.place);
    setWaitFix({ lat: found.lat, lng: found.lng });
    if (found.problem) {
      toast({ title: "Where are you?", description: found.problem });
    }
  };

  /** Clearing records where the car finished, and anything to be charged. */
  const confirmClear = async (job: Job) => {
    setLocating(true);
    const found = await currentPlace();
    setLocating(false);
    act.mutate({
      action: "progress",
      reference: job.reference,
      kind: "clear",
      place: found.place,
      note: clearNotes.trim(),
      ...(found.lat !== undefined ? { lat: found.lat, lng: found.lng } : {}),
    });
    setClearFor(null);
    setClearNotes("");
  };

  /** How long is left to take back a clear, in minutes. */
  const undoMinutesLeft = (job: Job) => {
    if (!job.driver_status_at || job.job_report_sent_at) return 0;
    const since = (Date.now() - Date.parse(job.driver_status_at)) / 60000;
    return Math.max(0, Math.ceil(UNDO_CLEAR_MINUTES - since));
  };

  const bigButtons = (job: Job) => {
    const busy = act.isPending || locating;
    const status = job.driver_status ?? null;
    // Nothing is pressable on a finished job, whatever else happens
    if (status === "clear" || clearedHere.includes(job.reference)) return null;

    if (clearFor === job.reference) {
      return (
        <div className="space-y-3">
          <p className="text-smoke text-xs tracking-[0.2em] uppercase">
            Anything to charge the passenger?
          </p>
          <Textarea
            autoFocus
            value={clearNotes}
            onChange={(e) => setClearNotes(e.target.value)}
            placeholder="Blanket, refreshments, a meal, parking, waiting time. Leave blank if nothing."
            className="rounded-none text-base min-h-24"
            maxLength={500}
          />
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              className="h-16 rounded-none tracking-[0.15em] uppercase"
              onClick={() => setClearFor(null)}
            >
              Back
            </Button>
            <Button
              disabled={busy}
              onClick={() => confirmClear(job)}
              className="h-16 rounded-none tracking-[0.15em] uppercase text-base"
            >
              {locating ? <Loader2 className="w-5 h-5 animate-spin" /> : "Finish job"}
            </Button>
          </div>
        </div>
      );
    }

    if (waitFor === job.reference) {
      return (
        <div className="space-y-3">
          <p className="text-smoke text-xs tracking-[0.2em] uppercase">Where are you waiting?</p>
          <Input
            autoFocus
            value={waitPlace}
            onChange={(e) => setWaitPlace(e.target.value)}
            placeholder={locating ? "Finding you..." : "e.g. Spinningfields, M3 3AQ"}
            className="h-14 rounded-none text-base"
            maxLength={200}
          />
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              className="h-16 rounded-none tracking-[0.15em] uppercase"
              onClick={() => setWaitFor(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              className="h-16 rounded-none tracking-[0.15em] uppercase text-base"
              onClick={() => {
                step(job, "waiting", waitPlace.trim(), waitFix);
                setWaitFor(null);
              }}
            >
              Start waiting
            </Button>
          </div>
        </div>
      );
    }

    const primary = (label: string, kind: Step, Icon: typeof Car) => (
      <Button
        disabled={busy}
        onClick={() => step(job, kind)}
        className="w-full h-24 rounded-none text-xl tracking-[0.2em] uppercase font-light"
      >
        {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : <Icon className="w-6 h-6 mr-3" />}
        {label}
      </Button>
    );

    if (status === null) return primary("En route", "en_route", Navigation);
    if (status === "en_route") return primary("Arrived", "arrived", MapPin);
    if (status === "arrived") return primary("Passenger on board", "pob", Car);

    // On board, or waiting for the passenger to come back
    return (
      <div className="space-y-3">
        {status === "waiting"
          ? primary("Passenger back on board", "pob", Car)
          : (
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => openWait(job)}
              className="w-full h-20 rounded-none text-lg tracking-[0.2em] uppercase font-light"
            >
              <PauseCircle className="w-5 h-5 mr-3" />
              Wait
            </Button>
          )}
        <Button
          disabled={busy}
          variant={status === "waiting" ? "outline" : "default"}
          onClick={() => {
            setClearNotes("");
            setClearFor(job.reference);
          }}
          className="w-full h-20 rounded-none text-lg tracking-[0.2em] uppercase font-light"
        >
          <Flag className="w-5 h-5 mr-3" />
          Clear
        </Button>
      </div>
    );
  };

  const jobHead = (job: Job) => {
    const asDirected = job.journey_type === "hourly";
    return (
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="font-mono text-champagne text-lg">{ukTime(job.collection_at)}</p>
            <p className="text-foreground text-2xl font-light tracking-wide">
              {job.name || "Passenger"}
            </p>
            <p className="text-smoke text-xs mt-1">
              {job.vehicle}
              {job.vehicleRegistration ? ` · ${job.vehicleRegistration}` : ""}
              {job.passengers ? ` · ${job.passengers} up` : ""}
            </p>
          </div>
          <span className="text-[10px] tracking-[0.15em] uppercase border border-champagne-muted text-champagne px-2 py-1">
            {whereItIs(job.driver_status)}
          </span>
        </div>

        <div className="text-sm text-smoke space-y-1">
          <p className="flex items-start gap-2">
            <MapPin className="w-4 h-4 text-champagne flex-none mt-0.5" />
            {addressLine(job.pickup) || "Pickup"}
            {job.pickup?.postcode ? ` · ${job.pickup.postcode}` : ""}
          </p>
          {asDirected ? (
            <p className="flex items-start gap-2 text-champagne">
              <Clock className="w-4 h-4 flex-none mt-0.5" />
              At your passenger's direction
              {job.as_directed_hours ? ` · ${job.as_directed_hours} hours` : ""}
            </p>
          ) : (
            <p className="flex items-start gap-2">
              <ArrowRight className="w-4 h-4 flex-none mt-0.5" />
              {addressLine(job.dropoff) || "Destination"}
              {job.dropoff?.postcode ? ` · ${job.dropoff.postcode}` : ""}
            </p>
          )}
        </div>

        {(job.notes || (job.children?.length ?? 0) > 0) && (
          <div className="border border-champagne-muted bg-champagne/5 px-3 py-2 text-xs text-smoke space-y-1">
            {(job.children?.length ?? 0) > 0 && (
              <p className="text-champagne">
                {job.children!.length} child{job.children!.length > 1 ? "ren" : ""} aboard, ages{" "}
                {job.children!.map((c) => c.age).join(", ")}
              </p>
            )}
            {job.notes && <p className="whitespace-pre-wrap">{job.notes}</p>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main
        className={
          isInstalledApp()
            ? "pt-[calc(env(safe-area-inset-top)+8.5rem)] pb-[calc(env(safe-area-inset-bottom)+6rem)]"
            : "pt-40 md:pt-44 pb-28"
        }
      >
        <div className="container mx-auto px-6 max-w-2xl space-y-5">
          {/* Who and when, and a way back for the office, who drive to test */}
          <div className="flex items-baseline gap-3">
            <p className="text-champagne text-xs tracking-[0.4em] uppercase">Chauffeur</p>
            <p className="text-smoke text-xs tracking-[0.15em]">
              {ukDay(current?.collection_at ?? null)}
            </p>
            {isAdmin && (
              <span className="ml-auto flex items-center gap-4">
                <Link
                  to="/bookings"
                  className="text-smoke hover:text-foreground transition-colors text-[10px] tracking-[0.2em] uppercase"
                >
                  Member
                </Link>
                <Link
                  to="/admin"
                  className="text-smoke hover:text-foreground transition-colors text-[10px] tracking-[0.2em] uppercase"
                >
                  Admin
                </Link>
              </span>
            )}
          </div>

          {!onShift ? (
            /* Off duty there is nothing else to do, so signing on is the screen.
               The clock is the timesheet, so a job worked without it is hours
               nobody is paid for. */
            <div className="border border-border p-8 text-center space-y-6">
              <div>
                <p className="text-foreground text-lg font-light tracking-wide mb-2">
                  You are off duty
                </p>
                <p className="text-smoke text-xs font-light leading-relaxed max-w-sm mx-auto">
                  Your jobs appear once you sign on, and the clock starts your timesheet.
                  Sign off at the end of the day.
                </p>
              </div>
              <Button
                disabled={act.isPending}
                onClick={() => act.mutate({ action: "shift_start" })}
                className="w-full h-24 rounded-none text-xl tracking-[0.2em] uppercase font-light"
              >
                {act.isPending ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <UserPlus className="w-6 h-6 mr-3" />
                )}
                Sign on
              </Button>
            </div>
          ) : (
            <>
              {/* On duty, the clock gets out of the way and the jobs take over */}
              <div className="flex items-center justify-between gap-4 border-b border-border pb-2.5">
                <p className="text-xs text-champagne tracking-[0.1em]">
                  On duty
                  <span className="text-smoke"> since {ukTime(shift!.started_at)}</span>
                </p>
                <button
                  disabled={act.isPending}
                  onClick={() => act.mutate({ action: "shift_end" })}
                  className="flex items-center gap-1.5 text-smoke hover:text-foreground transition-colors text-[10px] tracking-[0.2em] uppercase"
                >
                  <UserMinus className="w-3.5 h-3.5" />
                  Sign off
                </button>
              </div>

          {isLoading ? (
            <div className="py-16 text-center">
              <Loader2 className="w-6 h-6 animate-spin text-champagne mx-auto" />
            </div>
          ) : (
            <>
              {current ? (
                <>
                  {/* The job in hand, then the buttons, which is most of the screen */}
                  <div className="border border-border p-5">{jobHead(current)}</div>
                  {reportingFor === current.reference && (
                    <p className="text-smoke/70 text-[11px] tracking-[0.1em] flex items-center gap-2">
                      <Navigation className="w-3 h-3 text-champagne" />
                      Your passenger can see the car on their map until you clear this job
                    </p>
                  )}
                  <div>{bigButtons(current)}</div>

                  {/* What has happened on this job so far */}
                  {(() => {
                    const mine = waypoints.filter((w) => w.booking_reference === current.reference);
                    if (mine.length === 0) return null;
                    return (
                      <ul className="space-y-1.5 pt-1">
                        {mine.map((w) => (
                          <li key={w.id} className="flex items-baseline gap-3 text-xs">
                            <span className="font-mono text-smoke/70 flex-none">
                              {ukTime(w.recorded_at)}
                            </span>
                            <span className="text-champagne flex-none">{stepLabel[w.kind]}</span>
                            <span className="text-smoke">
                              {[w.place, w.note].filter(Boolean).join(" · ")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    );
                  })()}
                </>
              ) : done.length > 0 ? (
                <div className="border border-border p-8 text-center">
                  <CheckCheck className="w-6 h-6 text-champagne mx-auto mb-3" strokeWidth={1.5} />
                  <p className="text-foreground text-sm mb-2">Every job finished</p>
                  <p className="text-smoke text-xs font-light leading-relaxed max-w-sm mx-auto">
                    Nothing else is assigned to you. Sign off above when you are done for the day.
                  </p>
                </div>
              ) : (
                <div className="border border-border p-8 text-center">
                  <p className="text-foreground text-sm mb-2">No jobs assigned to you</p>
                  <p className="text-smoke text-xs font-light leading-relaxed max-w-sm mx-auto">
                    Jobs appear here once the office assigns you in Dispatch. If you are expecting
                    one, check with them that your mobile number matches the one they hold.
                  </p>
                </div>
              )}

              {/* Still to come. Shown, but not workable until its turn. */}
              {queue.length > 0 && (
                <div className="pt-2">
                  <p className="text-smoke text-[10px] tracking-[0.2em] uppercase mb-3">
                    {queue.length} still to come
                  </p>
                  <ul className="space-y-2">
                    {queue.map((j) => (
                      <li
                        key={j.reference}
                        className="border border-border/60 px-3 py-2.5 flex items-baseline gap-3 text-xs"
                      >
                        <span className="font-mono text-smoke/70 flex-none">
                          {ukTime(j.collection_at)}
                        </span>
                        <span className="text-foreground truncate">{j.name}</span>
                        <span className="text-smoke ml-auto flex-none">
                          {j.pickup?.postcode || addressLine(j.pickup)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Finished, and out of the way */}
              {done.length > 0 && (
                <div className="pt-2">
                  <button
                    onClick={() => setShowEarlier((v) => !v)}
                    className="text-smoke text-[10px] tracking-[0.2em] uppercase flex items-center gap-2"
                  >
                    <CheckCheck className="w-3.5 h-3.5 text-champagne" />
                    {done.length} finished {done.length === 1 ? "job" : "jobs"}
                  </button>
                  {showEarlier && (
                    <ul className="mt-3 space-y-2">
                      {done.map((j) => {
                        const clearedAt = waypoints
                          .filter((w) => w.booking_reference === j.reference && w.kind === "clear")
                          .at(-1);
                        const canUndo = undoMinutesLeft(j) > 0;
                        return (
                          <li
                            key={j.reference}
                            className={`border px-3 py-2.5 flex items-baseline gap-3 text-xs ${
                              canUndo ? "border-champagne-muted" : "border-border/40 opacity-60"
                            }`}
                          >
                            <CheckCheck className="w-3.5 h-3.5 text-champagne flex-none" />
                            <span className="font-mono text-smoke/70 flex-none">
                              {ukTime(j.collection_at)}
                            </span>
                            <span className="text-foreground truncate">{j.name}</span>
                            <span className="text-smoke ml-auto flex-none">
                              {clearedAt ? `Cleared ${ukTime(clearedAt.recorded_at)}` : "Cleared"}
                            </span>
                            {canUndo && (
                              <button
                                disabled={act.isPending}
                                onClick={() =>
                                  act.mutate({ action: "undo_clear", reference: j.reference })
                                }
                                className="flex-none text-champagne tracking-[0.15em] uppercase text-[10px] underline underline-offset-4"
                              >
                                Undo
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
            </>
          )}
        </div>
      </main>

      {/* The job after this one, kept to a thin line along the bottom */}
      {next && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-md border-t border-border pb-[env(safe-area-inset-bottom)]">
          <div className="container mx-auto px-6 max-w-2xl py-3 flex items-center gap-3 text-xs">
            <span className="text-champagne tracking-[0.2em] uppercase text-[10px] flex-none">Next</span>
            <span className="font-mono text-smoke/80 flex-none">{ukTime(next.collection_at)}</span>
            <span className="text-foreground truncate">{next.name}</span>
            <span className="text-smoke ml-auto flex-none">
              {next.pickup?.postcode || addressLine(next.pickup)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default Driver;
