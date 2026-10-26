import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

/** Both maps need WebGL, which a test has no use for and jsdom has none of. */
vi.mock("@/components/DriveMap", () => ({ default: () => <div data-testid="drive-map" /> }));

const maps = vi.hoisted(() => ({ configured: false, fails: false }));
vi.mock("@/components/DriveMapGoogle", () => ({
  default: ({ onUnavailable }: { onUnavailable: () => void }) => {
    if (maps.fails) queueMicrotask(onUnavailable);
    return <div data-testid="drive-map-google" />;
  },
}));
vi.mock("@/lib/googleMaps", () => ({ googleMapsConfigured: () => maps.configured }));

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

/** Hoisted so the mock can read it: the factory runs before the file body. */
const voice = vi.hoisted(() => ({ on: false, said: [] as { words: string; urgent: boolean }[] }));
vi.mock("@/lib/navVoice", () => ({
  canSpeak: () => voice.on,
  voiceWanted: () => voice.on,
  rememberVoice: vi.fn(),
  say: (words: string, opts?: { urgent?: boolean }) =>
    voice.said.push({ words, urgent: opts?.urgent === true }),
  hush: vi.fn(),
  wakeVoice: vi.fn(),
}));

import DriveScreen from "@/components/DriveScreen";

const PICKUP = { line1: "The Lowry Hotel", town: "Salford", postcode: "M3 5LH" };

/** A route due north, as the open router would hand it over. */
const openRoute = {
  provider: "open",
  withTraffic: false,
  route: {
    routes: [
      {
        distance: 1000,
        duration: 300,
        legs: [
          {
            steps: [
              {
                maneuver: { type: "depart", modifier: "straight" },
                name: "Chapel Street",
                distance: 500,
                duration: 150,
                geometry: {
                  coordinates: [
                    [-2.24, 53.48],
                    [-2.24, 53.4845],
                  ],
                },
              },
              {
                maneuver: { type: "turn", modifier: "left" },
                name: "Deansgate",
                distance: 500,
                duration: 150,
                geometry: {
                  coordinates: [
                    [-2.24, 53.4845],
                    [-2.24, 53.489],
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  },
};

/** Fixes the test can hand to the screen whenever it likes. */
let sendFix: ((lat: number, lng: number) => void) | null = null;

beforeEach(() => {
  invoke.mockReset();
  maps.configured = false;
  maps.fails = false;
  voice.on = false;
  voice.said = [];
  invoke.mockResolvedValue({ data: openRoute, error: null });

  // The postcode lookup the screen does before it can route anywhere
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { latitude: 53.489, longitude: -2.24 } }),
    })
  );

  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({
          coords: { latitude: 53.48, longitude: -2.24, heading: 0, speed: 10 },
        } as GeolocationPosition),
      watchPosition: (ok: PositionCallback) => {
          sendFix = (latitude, longitude) =>
            ok({ coords: { latitude, longitude, heading: 0, speed: 10 } } as GeolocationPosition);
          return 1;
        },
      clearWatch: () => {
        sendFix = null;
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  sendFix = null;
});

const driving = (props: Partial<Parameters<typeof DriveScreen>[0]> = {}) =>
  render(
    <DriveScreen
      reference="APX-1001"
      to={PICKUP}
      what="pickup"
      status={null}
      onAdvance={vi.fn()}
      onSetDown={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />
  );

describe("the screen a chauffeur drives by", () => {
  it("tells them what it is doing while it works the route out", () => {
    driving();
    expect(screen.getByText(/working out the way to the collection/i)).toBeInTheDocument();
  });

  /**
   * The turn being driven towards, not the street already being driven. A
   * banner reading "set off along Chapel Street" a hundred yards from a left
   * turn is how a chauffeur misses the left turn.
   */
  it("puts the turn that is coming across the top", async () => {
    driving();
    await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());
    sendFix?.(53.4805, -2.24);
    await waitFor(() => expect(screen.getByText("Turn left onto Deansgate")).toBeInTheDocument());
    expect(screen.queryByText(/set off along chapel street/i)).not.toBeInTheDocument();
  });

  it("counts the turn down in yards once it is close", async () => {
    driving();
    await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());
    sendFix?.(53.4825, -2.24);
    await waitFor(() => expect(screen.getByText(/^\d+ yds$/)).toBeInTheDocument());
  });

  it("counts it in miles while it is still a way off", async () => {
    driving();
    await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());
    sendFix?.(53.4805, -2.24);
    await waitFor(() => expect(screen.getByText(/^0\.\d miles$/)).toBeInTheDocument());
  });

  it("says when the car is due", async () => {
    driving();
    await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());
    sendFix?.(53.4805, -2.24);
    await waitFor(() => expect(screen.getByText(/\d+ min ·/)).toBeInTheDocument());
  });

  /**
   * An arrival time from a router that has never heard of the Mancunian Way at
   * five o'clock is a guess, and saying so is the difference between a late
   * car and a car nobody was told about.
   */
  it("owns up when the time it is quoting knows nothing about the traffic", async () => {
    driving();
    await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());
    sendFix?.(53.4805, -2.24);
    await waitFor(() => expect(screen.getByText(/allows for no traffic/i)).toBeInTheDocument());
  });

  it("offers the arrival to the office the moment the car is there", async () => {
    const onAdvance = vi.fn();
    driving({ onAdvance });
    await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());
    sendFix?.(53.489, -2.24);
    fireEvent.click(await screen.findByRole("button", { name: /i have arrived/i }));
    expect(onAdvance).toHaveBeenCalledWith("arrived");
  });

  /**
   * The step Waze could never offer. Marking the passenger aboard has to be
   * possible from the drive itself, or a chauffeur has to come out of
   * navigation between the two halves of every single job.
   */
  it("offers the passenger aboard once the collection is made, without leaving the drive", async () => {
    const onAdvance = vi.fn();
    driving({ status: "arrived", onAdvance });
    await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());
    sendFix?.(53.4805, -2.24);
    fireEvent.click(await screen.findByRole("button", { name: /passenger on board/i }));
    expect(onAdvance).toHaveBeenCalledWith("pob");
  });

  it("keeps the screen clear while there is nothing to press", async () => {
    driving();
    await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());
    sendFix?.(53.4805, -2.24);
    await waitFor(() => expect(screen.getByText(/min ·/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /i have arrived|passenger on board/i })).toBeNull();
  });

  /**
   * An hourly hire does not finish when the car pulls up. The passenger goes
   * into a meeting and comes back out, so offering to set them down there
   * would end a job that has hours left to run.
   */
  it("offers to wait, not to set down, when the passenger is directing", async () => {
    const onAdvance = vi.fn();
    const onSetDown = vi.fn();
    driving({
      what: "dropoff",
      status: "pob",
      asDirected: true,
      onAdvance,
      onSetDown,
      to: { line1: "Spinningfields", town: "Manchester", postcode: "WA15 9QA" },
    });
    await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());
    sendFix?.(53.489, -2.24);
    fireEvent.click(await screen.findByRole("button", { name: /wait here for the passenger/i }));
    expect(onAdvance).toHaveBeenCalledWith("waiting");
    expect(onSetDown).not.toHaveBeenCalled();
  });

  it("calls it a set down at the other end of the job", async () => {
    const onSetDown = vi.fn();
    driving({
      what: "dropoff",
      status: "pob",
      onSetDown,
      to: { line1: "Home", town: "Hale", postcode: "WA15 9QA" },
    });
    await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());
    sendFix?.(53.489, -2.24);
    fireEvent.click(await screen.findByRole("button", { name: /set the passenger down/i }));
    expect(onSetDown).toHaveBeenCalled();
  });

  /**
   * A route can fail for a tunnel or an underground car park, and the answer
   * to that is to ask again. Sending the chauffeur out to another app is the
   * one thing that stops the passenger seeing the car at all.
   */
  it("says why it cannot route, and offers another go rather than another app", async () => {
    driving({ to: { line1: "Somewhere", town: "Manchester", postcode: "" } });
    expect(await screen.findByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByText(/no postcode/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /waze/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /maps/i })).not.toBeInTheDocument();
  });

  it("offers another go when the route will not come", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("down") });
    driving();
    expect(await screen.findByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("actually asks again when another go is taken", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("down") });
    driving();
    fireEvent.click(await screen.findByRole("button", { name: /try again/i }));
    invoke.mockResolvedValue({ data: openRoute, error: null });
    await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());
  });

  /**
   * Why it would not come, not just that it would not.
   *
   * An hourly cap, a provider that will not answer and a signed out session
   * all stopped the car in exactly the same words, which left a chauffeur on
   * the kerb with nothing to report and nothing to try.
   */
  describe("saying why the route would not come", () => {
    it("reads out what the route service refused with", async () => {
      invoke.mockResolvedValue({
        data: null,
        error: Object.assign(new Error("non-2xx"), {
          context: new Response(JSON.stringify({ error: "Too many routes" }), { status: 429 }),
        }),
      });
      driving();
      expect(await screen.findByText(/too many routes \(429\)/i)).toBeInTheDocument();
    });

    it("falls back to the status when the refusal says nothing", async () => {
      invoke.mockResolvedValue({
        data: null,
        error: Object.assign(new Error("non-2xx"), {
          context: new Response("gateway", { status: 502 }),
        }),
      });
      driving();
      expect(await screen.findByText(/answered 502/i)).toBeInTheDocument();
    });

    it("reads out trouble the service reports in its own answer", async () => {
      invoke.mockResolvedValue({ data: { error: "A route needs both ends" }, error: null });
      driving();
      expect(await screen.findByText(/a route needs both ends/i)).toBeInTheDocument();
    });

    it("says so when the route arrives in a shape it cannot read", async () => {
      invoke.mockResolvedValue({
        data: { provider: "open", withTraffic: false, route: { routes: [] } },
        error: null,
      });
      driving();
      expect(await screen.findByText(/shape we could not read/i)).toBeInTheDocument();
    });

    it("keeps no reason from a failure that is not about the route", async () => {
      driving({ to: { line1: "Somewhere", town: "Manchester", postcode: "" } });
      expect(await screen.findByText(/no postcode/i)).toBeInTheDocument();
      expect(screen.queryByText(/route service/i)).not.toBeInTheDocument();
    });
  });

  /**
   * The hourly hire dead end.
   *
   * Marking the passenger aboard turns the drive round to the destination,
   * and on an hourly hire there is no destination yet because the passenger
   * has only just said it out loud. The screen used to call that a fault and
   * offer a way out of the app. It has to ask instead.
   */
  it("asks where to on an hourly hire, rather than calling it a fault", async () => {
    driving({
      what: "dropoff",
      status: "pob",
      asDirected: true,
      to: null,
      onDestination: vi.fn(),
    });
    expect(await screen.findByText(/where have they asked for/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/no postcode/i)).not.toBeInTheDocument();
  });

  it("hands the address straight back to the job, so the office gets it", async () => {
    const onDestination = vi.fn();
    driving({
      what: "dropoff",
      status: "pob",
      asDirected: true,
      to: null,
      onDestination,
    });
    const box = await screen.findByPlaceholderText(/address, place or postcode/i);
    expect(box).toBeInTheDocument();
    expect(onDestination).not.toHaveBeenCalled();
  });

  /**
   * A booked journey with no address is still a fault: the office should have
   * put one on the job, and there is nobody in the car to ask.
   */
  it("still calls a missing address a fault on a booked journey", async () => {
    driving({
      what: "dropoff",
      status: "pob",
      to: { line1: "Somewhere", town: "Manchester", postcode: "" },
      onDestination: vi.fn(),
    });
    expect(await screen.findByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("drives on once the destination has been put in", async () => {
    driving({
      what: "dropoff",
      status: "pob",
      asDirected: true,
      to: { line1: "Australasia", town: "Manchester", postcode: "M3 3AP" },
      onDestination: vi.fn(),
    });
    await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());
    expect(screen.queryByText(/where have they asked for/i)).not.toBeInTheDocument();
  });

  /**
   * The passenger asking for somewhere else, mid journey.
   *
   * The car must not turn on its own. A route that redraws itself at speed,
   * for a reason the chauffeur has not been told, is more dangerous than the
   * typing it saves.
   */
  describe("when the passenger asks for somewhere else", () => {
    const AWAY = { line1: "The Lowry Hotel", town: "Salford", postcode: "M3 5LH" };
    const INSTEAD = { line1: "Australasia", town: "Manchester", postcode: "M3 3AP" };

    const drivingTo = () =>
      render(
        <DriveScreen
          reference="APX-1001"
          to={AWAY}
          what="dropoff"
          status="pob"
          onAdvance={vi.fn()}
          onSetDown={vi.fn()}
          onClose={vi.fn()}
        />
      );

    it("tells the chauffeur rather than turning the car", async () => {
      const screenUnder = drivingTo();
      await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());
      const asked = invoke.mock.calls.length;

      screenUnder.rerender(
        <DriveScreen
          reference="APX-1001"
          to={INSTEAD}
          what="dropoff"
          status="pob"
          onAdvance={vi.fn()}
          onSetDown={vi.fn()}
          onClose={vi.fn()}
        />
      );

      expect(await screen.findByText(/your passenger has asked for/i)).toBeInTheDocument();
      expect(screen.getByText(/australasia/i)).toBeInTheDocument();
      // No new route was asked for, so the car is still going where it was
      expect(invoke.mock.calls.length).toBe(asked);
    });

    it("works the new way out once the chauffeur takes it", async () => {
      const screenUnder = drivingTo();
      await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());
      const asked = invoke.mock.calls.length;

      screenUnder.rerender(
        <DriveScreen
          reference="APX-1001"
          to={INSTEAD}
          what="dropoff"
          status="pob"
          onAdvance={vi.fn()}
          onSetDown={vi.fn()}
          onClose={vi.fn()}
        />
      );
      fireEvent.click(await screen.findByRole("button", { name: /drive there/i }));

      await waitFor(() => expect(invoke.mock.calls.length).toBeGreaterThan(asked));
      const last = invoke.mock.calls[invoke.mock.calls.length - 1] as [
        string,
        { body: Record<string, unknown> },
      ];
      expect(last[1].body.address).toContain("M3 3AP");
    });

    it("carries on to the old address when the chauffeur says not yet", async () => {
      const screenUnder = drivingTo();
      await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());

      screenUnder.rerender(
        <DriveScreen
          reference="APX-1001"
          to={INSTEAD}
          what="dropoff"
          status="pob"
          onAdvance={vi.fn()}
          onSetDown={vi.fn()}
          onClose={vi.fn()}
        />
      );
      fireEvent.click(await screen.findByRole("button", { name: /not yet/i }));
      expect(screen.queryByText(/your passenger has asked for/i)).not.toBeInTheDocument();
      // Still navigating, not stuck and not asking
      expect(screen.getByTestId("drive-map")).toBeInTheDocument();
    });

    /**
     * After "not yet" the car is still going to the old address while the
     * props hold the new one, so a traffic refresh has to keep asking about
     * the place being driven to. Ask about the new place from the door of the
     * old one and the answer is a route to neither.
     *
     * Today the watcher cannot re-read the props while a change is pending,
     * so the address it sends is passed in explicitly rather than left to
     * that being true. This pins the behaviour either way.
     */
    it("refreshes against the address it is actually driving to, not the new one", async () => {
      const screenUnder = drivingTo();
      await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());

      screenUnder.rerender(
        <DriveScreen
          reference="APX-1001"
          to={INSTEAD}
          what="dropoff"
          status="pob"
          onAdvance={vi.fn()}
          onSetDown={vi.fn()}
          onClose={vi.fn()}
        />
      );
      fireEvent.click(await screen.findByRole("button", { name: /not yet/i }));

      // Far enough past the settle and staleness windows that the next fix
      // makes the screen ask about the traffic again
      const realNow = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(realNow + 400_000);
      const asked = invoke.mock.calls.length;
      sendFix?.(53.4805, -2.24);

      await waitFor(() => expect(invoke.mock.calls.length).toBeGreaterThan(asked));
      const last = invoke.mock.calls[invoke.mock.calls.length - 1] as [
        string,
        { body: Record<string, unknown> },
      ];
      expect(last[1].body.address).toContain("M3 5LH");
      expect(last[1].body.address).not.toContain("M3 3AP");
    });

    it("says it out loud, because the chauffeur is watching the road", async () => {
      voice.on = true;
      const screenUnder = drivingTo();
      await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());
      voice.said = [];

      screenUnder.rerender(
        <DriveScreen
          reference="APX-1001"
          to={INSTEAD}
          what="dropoff"
          status="pob"
          onAdvance={vi.fn()}
          onSetDown={vi.fn()}
          onClose={vi.fn()}
        />
      );
      await screen.findByText(/your passenger has asked for/i);
      expect(voice.said.some((s) => /passenger has asked for/i.test(s.words))).toBe(true);
    });
  });

  it("asks for a route from where the car actually is, pointing the way it points", async () => {
    driving();
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    const [name, options] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(name).toBe("route");
    expect(options.body.from).toEqual({ lat: 53.48, lng: -2.24 });
    expect(options.body.heading).toBe(0);
    expect(options.body.address).toContain("M3 5LH");
  });
});

describe("the voice that reads the turns out", () => {
  const words = () => voice.said.map((s) => s.words);

  it("gives warning of the turn, with the distance first", async () => {
    voice.on = true;
    driving();
    await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());
    sendFix?.(53.4825, -2.24);
    await waitFor(() =>
      expect(words().some((w) => /^In \d+ yards, turn left onto Deansgate$/.test(w))).toBe(true)
    );
  });

  it("just says it at the junction, and cuts off whatever it was saying", async () => {
    voice.on = true;
    driving();
    await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());
    sendFix?.(53.4843, -2.24);
    await waitFor(() => expect(words()).toContain("Turn left onto Deansgate"));
    expect(voice.said.find((s) => s.words === "Turn left onto Deansgate")?.urgent).toBe(true);
  });

  /**
   * Fixes arrive every second or two. A voice that announced on each of them
   * would talk over itself the whole way down the road.
   */
  it("says each announcement once, however many fixes arrive", async () => {
    voice.on = true;
    driving();
    await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());
    sendFix?.(53.4826, -2.24);
    await waitFor(() => expect(words().length).toBeGreaterThan(0));
    const first = words().length;
    // Each fix on its own turn, as they arrive from the phone, so the effect
    // really does run again rather than being batched into one render
    for (const lat of [53.48262, 53.48264, 53.48266]) {
      sendFix?.(lat, -2.24);
      await new Promise((settle) => setTimeout(settle, 0));
    }
    expect(words().length).toBe(first);
  });

  it("says where they have arrived, so it is not just a chime", async () => {
    voice.on = true;
    driving();
    await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());
    sendFix?.(53.489, -2.24);
    await waitFor(() => expect(words()).toContain("You have arrived at the collection"));
  });

  it("stays quiet when the chauffeur has turned it off", async () => {
    voice.on = false;
    driving();
    await waitFor(() => expect(screen.getByTestId("drive-map")).toBeInTheDocument());
    sendFix?.(53.4825, -2.24);
    sendFix?.(53.4843, -2.24);
    await waitFor(() => expect(screen.getByText(/deansgate/i)).toBeInTheDocument());
    expect(words().filter((w) => w.includes("Deansgate"))).toEqual([]);
  });
});

describe("which map the chauffeur gets", () => {
  it("uses Google's, which is the one the routing is licensed to be drawn on", async () => {
    maps.configured = true;
    driving();
    expect(await screen.findByTestId("drive-map-google")).toBeInTheDocument();
    expect(screen.queryByTestId("drive-map")).not.toBeInTheDocument();
  });

  /**
   * A chauffeur at a kerb needs a road on the screen more than they need the
   * right supplier of it, so a key or a signal that has failed falls back
   * rather than leaving them looking at black.
   */
  it("falls back to the open map when Google will not load", async () => {
    maps.configured = true;
    maps.fails = true;
    driving();
    expect(await screen.findByTestId("drive-map")).toBeInTheDocument();
  });

  it("uses the open map when this build has no Google key", async () => {
    maps.configured = false;
    driving();
    expect(await screen.findByTestId("drive-map")).toBeInTheDocument();
    expect(screen.queryByTestId("drive-map-google")).not.toBeInTheDocument();
  });
});

describe("light or dark, as the chauffeur prefers", () => {
  it("offers to switch, and says which way it is going", async () => {
    localStorage.setItem("apx.drive.map", "dark");
    driving();
    expect(await screen.findByRole("button", { name: /switch to the light map/i })).toBeInTheDocument();
  });

  /**
   * A chauffeur who flipped it at midday should not find it flipped back on
   * the next job, so the choice outlives the drive.
   */
  it("remembers the choice for the next job", async () => {
    localStorage.setItem("apx.drive.map", "dark");
    driving();
    fireEvent.click(await screen.findByRole("button", { name: /switch to the light map/i }));
    expect(localStorage.getItem("apx.drive.map")).toBe("light");
    expect(screen.getByRole("button", { name: /switch to the dark map/i })).toBeInTheDocument();
  });

  it("starts on what the chauffeur last chose", async () => {
    localStorage.setItem("apx.drive.map", "light");
    driving();
    expect(await screen.findByRole("button", { name: /switch to the dark map/i })).toBeInTheDocument();
  });
});
