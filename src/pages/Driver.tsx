import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, MapPin, ArrowRight, Clock, UserMinus, UserPlus, StickyNote } from "lucide-react";
import Header from "@/components/Header";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { isInstalledApp } from "@/lib/appLinks";

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
  dispatchStatus: string | null;
  vehicleRegistration: string;
}

interface Waypoint {
  id: string;
  booking_reference: string;
  kind: "set_down" | "collected" | "waiting" | "note";
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
  iso
    ? new Date(iso).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "Europe/London",
      })
    : "";

const addressLine = (a: Job["pickup"]) =>
  [a?.line1, a?.town].filter(Boolean).join(", ") || "";

const kindLabel: Record<Waypoint["kind"], string> = {
  set_down: "Set down",
  collected: "Collected",
  waiting: "Waiting",
  note: "Note",
};

const Driver = () => {
  const { user, profile, mfaVerified, mfaResolved, loading } = useAuth();
  const queryClient = useQueryClient();
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [placeText, setPlaceText] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["driver-day"],
    queryFn: () => callDriver({ action: "today" }),
    enabled: !!user && mfaVerified,
    refetchInterval: 60_000,
  });

  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => callDriver(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["driver-day"] }),
    onError: (err: Error) =>
      toast({ title: "Not saved", description: err.message, variant: "destructive" }),
  });

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
  const jobs = (data?.jobs ?? []) as Job[];
  const waypoints = (data?.waypoints ?? []) as Waypoint[];

  const onShift = !!shift;
  const shiftSince = shift ? ukTime(shift.started_at) : "";

  const log = (reference: string, kind: Waypoint["kind"], place = "") =>
    act.mutate({ action: "waypoint_add", reference, kind, place });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main
        className={
          isInstalledApp()
            ? "pt-[calc(env(safe-area-inset-top)+8.5rem)] pb-[calc(env(safe-area-inset-bottom)+5.5rem)]"
            : "pt-40 md:pt-44 pb-16"
        }
      >
        <div className="container mx-auto px-8 max-w-2xl space-y-6">
          <div>
            <p className="text-champagne text-xs tracking-[0.4em] uppercase mb-2">Chauffeur</p>
            <h1 className="font-display text-3xl font-light tracking-wider text-foreground">
              {jobs.length > 0 ? ukDay(jobs[0].collection_at) : "Your day"}
            </h1>
          </div>

          {/* Shift clock */}
          <div className="border border-border p-4 flex items-center justify-between gap-4">
            <div>
              <p className={`text-sm ${onShift ? "text-champagne" : "text-smoke"}`}>
                {onShift ? "On duty" : "Off duty"}
              </p>
              <p className="text-smoke text-xs mt-0.5">
                {onShift ? `Signed on at ${shiftSince}` : "Sign on when you start your day"}
              </p>
            </div>
            <Button
              variant={onShift ? "outline" : "default"}
              size="sm"
              disabled={act.isPending}
              onClick={() => act.mutate({ action: onShift ? "shift_end" : "shift_start" })}
              className="tracking-[0.15em] uppercase"
            >
              {onShift ? (
                <>
                  <UserMinus className="w-4 h-4 mr-2" />
                  Sign off
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4 mr-2" />
                  Sign on
                </>
              )}
            </Button>
          </div>

          {isLoading ? (
            <div className="py-16 text-center">
              <Loader2 className="w-6 h-6 animate-spin text-champagne mx-auto" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="border border-border p-8 text-center">
              <p className="text-foreground text-sm mb-2">No jobs assigned to you yet</p>
              <p className="text-smoke text-xs font-light leading-relaxed max-w-sm mx-auto">
                Jobs appear here once the office assigns you to them in Dispatch. If you are expecting
                one, check with the office that your mobile number matches the one they hold.
              </p>
            </div>
          ) : (
            jobs.map((job) => {
              const asDirected = job.journey_type === "hourly";
              const mine = waypoints.filter((w) => w.booking_reference === job.reference);
              return (
                <div key={job.reference} className="border border-border p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <p className="font-mono text-champagne text-sm">{ukTime(job.collection_at)}</p>
                      <p className="text-foreground text-lg font-light tracking-wide">
                        {job.name || "Passenger"}
                      </p>
                      <p className="text-smoke text-xs mt-0.5">
                        {job.vehicle}
                        {job.vehicleRegistration ? ` · ${job.vehicleRegistration}` : ""}
                        {job.passengers ? ` · ${job.passengers} up` : ""}
                      </p>
                    </div>
                    {job.dispatchStatus && (
                      <span className="text-[10px] tracking-[0.15em] uppercase border border-champagne-muted text-champagne px-2 py-1">
                        {job.dispatchStatus}
                      </span>
                    )}
                  </div>

                  <div className="text-sm text-smoke space-y-1">
                    <p className="flex items-start gap-2">
                      <MapPin className="w-3.5 h-3.5 text-champagne flex-none mt-1" />
                      {addressLine(job.pickup) || "Pickup"}
                    </p>
                    {asDirected ? (
                      <p className="flex items-start gap-2 text-champagne">
                        <Clock className="w-3.5 h-3.5 flex-none mt-1" />
                        At your passenger's direction
                        {job.as_directed_hours ? ` · ${job.as_directed_hours} hours` : ""}
                      </p>
                    ) : (
                      <p className="flex items-start gap-2">
                        <ArrowRight className="w-3.5 h-3.5 flex-none mt-1" />
                        {addressLine(job.dropoff) || "Destination"}
                      </p>
                    )}
                  </div>

                  {(job.notes || (job.children?.length ?? 0) > 0) && (
                    <div className="border border-champagne-muted bg-champagne/5 px-3 py-2 text-xs text-smoke space-y-1">
                      {(job.children?.length ?? 0) > 0 && (
                        <p className="text-champagne">
                          {job.children!.length} child
                          {job.children!.length > 1 ? "ren" : ""} aboard, ages{" "}
                          {job.children!.map((c) => c.age).join(", ")}
                        </p>
                      )}
                      {job.notes && <p className="whitespace-pre-wrap">{job.notes}</p>}
                    </div>
                  )}

                  {/* The log Dispatch cannot keep: stops within one job */}
                  <div className="border-t border-border pt-4 space-y-3">
                    <p className="text-smoke text-[10px] tracking-[0.2em] uppercase">
                      {asDirected ? "Stops on this job" : "Job log"}
                    </p>

                    {mine.length > 0 && (
                      <ul className="space-y-1.5">
                        {mine.map((w) => (
                          <li key={w.id} className="flex items-baseline gap-3 text-xs">
                            <span className="font-mono text-smoke/70 flex-none">
                              {ukTime(w.recorded_at)}
                            </span>
                            <span className="text-champagne flex-none">{kindLabel[w.kind]}</span>
                            <span className="text-smoke">
                              {[w.place, w.note].filter(Boolean).join(" · ")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {noteFor === job.reference ? (
                      <div className="flex gap-2">
                        <Input
                          autoFocus
                          value={placeText}
                          onChange={(e) => setPlaceText(e.target.value)}
                          placeholder="Where? e.g. Spinningfields"
                          className="h-10 rounded-none text-sm"
                          maxLength={200}
                        />
                        <Button
                          size="sm"
                          disabled={act.isPending}
                          onClick={() => {
                            log(job.reference, "set_down", placeText.trim());
                            setPlaceText("");
                            setNoteFor(null);
                          }}
                          className="tracking-[0.15em] uppercase flex-none"
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setPlaceText("");
                            setNoteFor(null);
                          }}
                          className="flex-none"
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={act.isPending}
                          onClick={() => {
                            setPlaceText("");
                            setNoteFor(job.reference);
                          }}
                          className="tracking-[0.15em] uppercase"
                        >
                          Set down
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={act.isPending}
                          onClick={() => log(job.reference, "collected")}
                          className="tracking-[0.15em] uppercase"
                        >
                          Collected
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={act.isPending}
                          onClick={() => log(job.reference, "waiting")}
                          className="tracking-[0.15em] uppercase text-smoke"
                        >
                          <StickyNote className="w-3.5 h-3.5 mr-1.5" />
                          Waiting
                        </Button>
                      </div>
                    )}

                    {asDirected && mine.length === 0 && (
                      <p className="text-smoke/60 text-xs font-light">
                        Tap Set down each time your passenger leaves the car, and Collected when they
                        return. The office can then see the whole day.
                      </p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
};

export default Driver;
