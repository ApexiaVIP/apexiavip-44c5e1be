import { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import CountryCodeSelect from "@/components/CountryCodeSelect";
import { format } from "date-fns";
import { CalendarIcon, Check, Users, Luggage, Minus, Plus, X, Baby } from "lucide-react";
import { z } from "zod";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import LocationSearch from "@/components/LocationSearch";
import type { PlaceSuggestion } from "@/lib/mfa";

import rangeRover from "@/assets/vehicle-range-rover.jpg";
import sClass from "@/assets/vehicle-s-class.jpg";
import vClass from "@/assets/vehicle-v-class.jpg";
import jetClass from "@/assets/vehicle-jet-class.jpg";

const vehicles = [
  { name: "Range Rover", image: rangeRover },
  { name: "S-Class", image: sClass },
  { name: "Viano", image: vClass },
  { name: "JetClass", image: jetClass },
];

const addressSchema = z.object({
  line1: z.string().trim().min(1, "Address line 1 is required").max(200),
  line2: z.string().trim().max(200).optional().default(""),
  town: z.string().trim().min(1, "Town/City is required").max(100),
  postcode: z.string().trim().min(1, "Postcode is required").max(20),
  country: z.string().trim().max(100).optional().default("United Kingdom"),
});

// Dropoff and stops share this shape; requiredness depends on journey type
const looseAddressSchema = z.object({
  line1: z.string().trim().max(200).default(""),
  line2: z.string().trim().max(200).default(""),
  town: z.string().trim().max(100).default(""),
  postcode: z.string().trim().max(20).default(""),
  country: z.string().trim().max(100).default("United Kingdom"),
});

/**
 * How much warning we need for a car. Below this the app sends people to the
 * office, who can see which chauffeurs are actually free. Change this one
 * number to change the rule everywhere.
 */
export const MIN_NOTICE_MINUTES = 90;

/** Midnight today: the earliest day that can be chosen. */
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export const MIN_HIRE_HOURS = 3;
export const MAX_HIRE_HOURS = 12;
const MAX_STOPS = 5;

export const MAX_CHILDREN = 8;
export const MAX_NOTES = 1000;

const businessSchema = z.object({
  company: z.string().trim().max(120).default(""),
  department: z.string().trim().max(120).default(""),
  clients: z.string().trim().max(300).default(""),
  pa_name: z.string().trim().max(120).default(""),
  pa_contact: z.string().trim().max(200).default(""),
  invoice_address: z.string().trim().max(400).default(""),
});

const clientCarSchema = z.object({
  make_model: z.string().trim().max(80).default(""),
  registration: z.string().trim().max(20).default(""),
  client_travelling: z.boolean().default(true),
});

/** What we fit for a child of this age; mirrors the server rule. */
export const seatFor = (age: number) =>
  age < 1 ? "baby seat" : age < 4 ? "child seat" : age < 12 ? "booster" : "no seat needed";

export const bookingSchema = z
  .object({
    bookingType: z.enum(["personal", "business"]),
    business: businessSchema,
    notes: z.string().trim().max(MAX_NOTES, `Please keep notes under ${MAX_NOTES} characters`).default(""),
    children: z.array(z.object({ age: z.number().int().min(0).max(17) })).max(MAX_CHILDREN),
    clientCar: clientCarSchema,
    name: z.string().trim().min(1, "Name is required").max(100),
    email: z.string().trim().email("Invalid email address").max(255),
    phone: z.string().trim().min(1, "Phone number is required").max(30),
    travelDate: z.date({ required_error: "Please select a travel date" }),
    collectionTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Please select a pickup time"),
    vehicle: z.string().default(""),
    passengers: z.number().min(1, "At least 1 passenger").max(20),
    bags: z.number().min(0).max(30),
    journeyType: z.enum(["destination", "hourly", "client_car"]),
    asDirectedHours: z.string().default(""),
    returnJourney: z.boolean().default(false),
    returnDate: z.date().optional(),
    returnTime: z.string().default(""),
    pickupAddress: addressSchema,
    dropoffAddress: looseAddressSchema,
    viaStops: z.array(looseAddressSchema).max(MAX_STOPS),
  })
  .superRefine((v, ctx) => {
    const requireAddress = (
      addr: { line1?: string; town?: string; postcode?: string },
      path: (string | number)[]
    ) => {
      if (!addr.line1)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "line1"], message: "Address line 1 is required" });
      if (!addr.town)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "town"], message: "Town/City is required" });
      if (!addr.postcode)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "postcode"], message: "Postcode is required" });
    };
    // The client's own car needs no Apexia vehicle; everything else does
    if (v.journeyType === "client_car") {
      if (!v.clientCar.make_model)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["clientCar", "make_model"], message: "Make and model are required" });
      if (!v.clientCar.registration)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["clientCar", "registration"], message: "Registration is required" });
    } else if (!v.vehicle) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["vehicle"], message: "Please select a vehicle" });
    }
    // Enough warning to find a chauffeur. This also stops a time earlier
    // today being chosen, which the date picker alone cannot catch.
    if (v.travelDate && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.collectionTime)) {
      const pickup = new Date(v.travelDate);
      const [h, m] = v.collectionTime.split(":").map(Number);
      pickup.setHours(h, m, 0, 0);
      const earliest = new Date(Date.now() + MIN_NOTICE_MINUTES * 60 * 1000);
      if (pickup < earliest) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["collectionTime"],
          message: `We need at least ${MIN_NOTICE_MINUTES} minutes' notice. For a car sooner, please call us.`,
        });
      }
    }

    // A return needs a when, and it has to be after we set off
    if (v.returnJourney && v.journeyType !== "hourly") {
      if (!v.returnDate) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["returnDate"], message: "Please choose the return date" });
      }
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.returnTime)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["returnTime"], message: "Please choose the return time" });
      }
      if (v.returnDate && v.travelDate && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.returnTime) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.collectionTime)) {
        const out = new Date(v.travelDate);
        const [oh, om] = v.collectionTime.split(":").map(Number);
        out.setHours(oh, om, 0, 0);
        const back = new Date(v.returnDate);
        const [rh, rm] = v.returnTime.split(":").map(Number);
        back.setHours(rh, rm, 0, 0);
        if (back.getTime() <= out.getTime()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["returnTime"],
            message: "The return must be after the outward journey",
          });
        }
      }
    }
    if (v.bookingType === "business" && !v.business.company) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["business", "company"], message: "Company name is required" });
    }
    if (v.journeyType !== "hourly") {
      requireAddress(v.dropoffAddress, ["dropoffAddress"]);
      v.viaStops.forEach((s, i) => requireAddress(s, ["viaStops", i]));
    } else {
      const hours = parseInt(v.asDirectedHours, 10);
      if (!Number.isFinite(hours) || hours < MIN_HIRE_HOURS || hours > MAX_HIRE_HOURS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["asDirectedHours"],
          message: `Please choose a hire duration (minimum ${MIN_HIRE_HOURS} hours)`,
        });
      }
    }
  });

type BookingFormValues = z.infer<typeof bookingSchema>;

const BookingForm = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedReturn, setSubmittedReturn] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [countryCode, setCountryCode] = useState("+44");
  const [searchParams, setSearchParams] = useSearchParams();

  const form = useForm<BookingFormValues>({
    resolver: zodResolver(bookingSchema),
    defaultValues: {
      bookingType: "personal",
      business: { company: "", department: "", clients: "", pa_name: "", pa_contact: "", invoice_address: "" },
      notes: "",
      children: [],
      clientCar: { make_model: "", registration: "", client_travelling: true },
      name: "",
      email: "",
      phone: "",
      collectionTime: "",
      vehicle: "",
      passengers: 1,
      bags: 1,
      journeyType: "destination",
      asDirectedHours: "",
      returnJourney: false,
      returnDate: undefined,
      returnTime: "",
      pickupAddress: { line1: "", line2: "", town: "", postcode: "", country: "United Kingdom" },
      dropoffAddress: { line1: "", line2: "", town: "", postcode: "", country: "United Kingdom" },
      viaStops: [],
    },
  });

  const {
    fields: stopFields,
    append: appendStop,
    remove: removeStop,
  } = useFieldArray({ control: form.control, name: "viaStops" });
  const {
    fields: childFields,
    append: appendChild,
    remove: removeChild,
  } = useFieldArray({ control: form.control, name: "children" });
  const journeyType = form.watch("journeyType");
  const bookingType = form.watch("bookingType");
  const returnJourney = form.watch("returnJourney");
  const childAges = form.watch("children");

  const { profile } = useAuth();

  // Prefill contact details from the signed-in member's profile
  useEffect(() => {
    if (!profile) return;
    if (!form.getValues("name") && profile.full_name) {
      form.setValue("name", profile.full_name);
    }
    if (!form.getValues("email") && profile.email) {
      form.setValue("email", profile.email);
    }
    if (!form.getValues("phone") && profile.phone.startsWith("+44")) {
      setCountryCode("+44");
      form.setValue("phone", profile.phone.slice(3));
    }
    // The last business details this member used, so they are not retyped
    const defaults = (profile as { business_defaults?: Record<string, string> | null }).business_defaults;
    if (defaults && !form.getValues("business.company")) {
      form.setValue("business", {
        company: defaults.company ?? "",
        department: defaults.department ?? "",
        clients: defaults.clients ?? "",
        pa_name: defaults.pa_name ?? "",
        pa_contact: defaults.pa_contact ?? "",
        invoice_address: defaults.invoice_address ?? "",
      });
    }
  }, [profile]);

  // Pre-select vehicle from URL param (e.g. ?vehicle=Range+Rover)
  useEffect(() => {
    const vehicleParam = searchParams.get("vehicle");
    if (vehicleParam && vehicles.some((v) => v.name === vehicleParam)) {
      form.setValue("vehicle", vehicleParam);
      // Clean up the URL param
      searchParams.delete("vehicle");
      setSearchParams(searchParams, { replace: true });
    }
  }, []);

  const selectedVehicle = form.watch("vehicle");

  // Amend mode: /?edit=<reference> pre-fills the form from the stored booking
  const editRef = searchParams.get("edit");
  const [editing, setEditing] = useState<string | null>(null);
  const editLoadedRef = useRef(false);
  useEffect(() => {
    if (!editRef || editLoadedRef.current) return;
    editLoadedRef.current = true;
    (async () => {
      const { data } = await supabase
        .from("bookings")
        .select("*")
        .eq("reference", editRef)
        .maybeSingle();
      if (!data) {
        toast({
          title: "Booking not found",
          description: "We could not load that booking to amend.",
          variant: "destructive",
        });
        return;
      }
      setEditing(editRef);
      const collection = data.collection_at ? new Date(data.collection_at) : undefined;
      const phoneMatch = (data.phone ?? "").match(/^(\+\d{1,4})\s*(.*)$/);
      if (phoneMatch) setCountryCode(phoneMatch[1]);
      const pickup = (data.pickup ?? {}) as Record<string, string>;
      const dropoff = (data.dropoff ?? {}) as Record<string, string>;
      const row = data as typeof data & {
        notes?: string | null;
        children?: { age: number }[] | null;
        booking_type?: string | null;
        business?: Record<string, string> | null;
        client_car?: { make_model?: string; registration?: string; client_travelling?: boolean } | null;
      };
      form.reset({
        bookingType: row.booking_type === "business" ? "business" : "personal",
        business: {
          company: row.business?.company ?? "",
          department: row.business?.department ?? "",
          clients: row.business?.clients ?? "",
          pa_name: row.business?.pa_name ?? "",
          pa_contact: row.business?.pa_contact ?? "",
          invoice_address: row.business?.invoice_address ?? "",
        },
        notes: row.notes ?? "",
        children: Array.isArray(row.children) ? row.children.map((c) => ({ age: Number(c.age) || 0 })) : [],
        clientCar: {
          make_model: row.client_car?.make_model ?? "",
          registration: row.client_car?.registration ?? "",
          client_travelling: row.client_car?.client_travelling !== false,
        },
        name: data.name,
        email: data.email,
        phone: phoneMatch ? phoneMatch[2] : data.phone,
        travelDate: collection,
        collectionTime: collection
          ? `${String(collection.getHours()).padStart(2, "0")}:${String(collection.getMinutes()).padStart(2, "0")}`
          : "",
        vehicle: data.journey_type === "client_car" ? "" : data.vehicle,
        passengers: data.passengers ?? 1,
        bags: data.bags ?? 0,
        journeyType:
          data.journey_type === "hourly"
            ? "hourly"
            : data.journey_type === "client_car"
              ? "client_car"
              : "destination",
        asDirectedHours: data.as_directed_hours ? String(data.as_directed_hours) : "",
        viaStops: Array.isArray(data.via)
          ? (data.via as Record<string, string>[]).map((s) => ({
              line1: s.line1 ?? "",
              line2: s.line2 ?? "",
              town: s.town ?? "",
              postcode: s.postcode ?? "",
              country: s.country ?? "United Kingdom",
            }))
          : [],
        pickupAddress: {
          line1: pickup.line1 ?? "",
          line2: pickup.line2 ?? "",
          town: pickup.town ?? "",
          postcode: pickup.postcode ?? "",
          country: pickup.country ?? "United Kingdom",
        },
        dropoffAddress: {
          line1: dropoff.line1 ?? "",
          line2: dropoff.line2 ?? "",
          town: dropoff.town ?? "",
          postcode: dropoff.postcode ?? "",
          country: dropoff.country ?? "United Kingdom",
        },
      });
    })();
  }, [editRef]);

  type AddressPath = "pickupAddress" | "dropoffAddress" | `viaStops.${number}`;
  const applyPlace = (prefix: AddressPath) => (s: PlaceSuggestion) => {
    const set = (key: string, value: string, validate = false) =>
      form.setValue(key as Parameters<typeof form.setValue>[0], value, {
        shouldValidate: validate,
      });
    set(`${prefix}.line1`, s.line1, true);
    set(`${prefix}.line2`, s.line2);
    set(`${prefix}.town`, s.town, true);
    set(`${prefix}.postcode`, s.postcode, true);
    set(`${prefix}.country`, s.country || "United Kingdom");
  };

  const onSubmit = async (data: BookingFormValues) => {
    setIsSubmitting(true);
    try {
      const [hours, minutes] = data.collectionTime.split(":").map(Number);
      const collectionAt = new Date(data.travelDate);
      collectionAt.setHours(hours, minutes, 0, 0);

      const { data: result, error } = await supabase.functions.invoke(
        "send-booking",
        {
          body: {
            name: data.name,
            email: data.email,
            phone: `${countryCode} ${data.phone}`,
            travelDate: `${format(data.travelDate, "PPP")} at ${data.collectionTime}`,
            travelDateRaw: `${format(data.travelDate, "dd-MMM-yyyy")} ${data.collectionTime}`,
            collectionAt: collectionAt.toISOString(),
            amendReference: editing ?? undefined,
            vehicle: data.journeyType === "client_car" ? undefined : data.vehicle,
            passengers: data.passengers,
            bags: data.bags,
            journeyType: data.journeyType,
            asDirectedHours:
              data.journeyType === "hourly" ? parseInt(data.asDirectedHours, 10) : undefined,
            pickupAddress: data.pickupAddress,
            dropoffAddress: data.journeyType !== "hourly" ? data.dropoffAddress : undefined,
            viaStops: data.journeyType !== "hourly" ? data.viaStops : [],
            returnJourney: data.returnJourney && data.journeyType !== "hourly",
            ...(data.returnJourney && data.journeyType !== "hourly" && data.returnDate
              ? (() => {
                  const [rh, rm] = data.returnTime.split(":").map(Number);
                  const back = new Date(data.returnDate);
                  back.setHours(rh, rm, 0, 0);
                  return {
                    returnCollectionAt: back.toISOString(),
                    returnTravelDate: `${format(data.returnDate, "PPP")} at ${data.returnTime}`,
                    returnTravelDateRaw: `${format(data.returnDate, "dd-MMM-yyyy")} ${data.returnTime}`,
                  };
                })()
              : {}),
            notes: data.notes || undefined,
            children: data.children,
            bookingType: data.bookingType,
            business: data.bookingType === "business" ? data.business : undefined,
            clientCar: data.journeyType === "client_car" ? data.clientCar : undefined,
            website: honeypot,
          },
        }
      );

      if (error) throw error;

      setSubmitted(true);
      setSubmittedReturn(data.returnJourney && data.journeyType !== "hourly");
      toast({
        title: result?.handedToOps
          ? "Changes sent to our team"
          : editing
            ? "Booking Updated"
            : "Enquiry Sent",
        description:
          result?.handedToOps || result?.returnHandedToOps
            ? result.message
            : editing
              ? "Your changes have been sent to our team."
              : result?.returnBooked
                ? "Both journeys are with us. We will text you as soon as each chauffeur is confirmed."
                : "We will text you as soon as your chauffeur is confirmed.",
      });
    } catch (err) {
      console.error(err);
      toast({
        title: "Something went wrong",
        description: "Please try again or contact us directly.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="text-center py-16 animate-fade-in">
        <div className="w-12 h-12 rounded-full border border-champagne-muted flex items-center justify-center mx-auto mb-6">
          <Check className="w-5 h-5 text-champagne" />
        </div>
        <h3 className="font-display text-2xl tracking-wider text-foreground mb-3">
          {editing ? "Booking Updated" : "Booking Received"}
        </h3>
        <p className="text-smoke text-sm font-light max-w-sm mx-auto leading-relaxed">
          {editing
            ? "Your changes have been sent to our team, who will confirm them shortly."
            : `Your booking has been sent to Apexia VIP.${
                submittedReturn ? " Your return journey has been booked as a second car." : ""
              } All bookings are subject to availability; we will confirm by text once your chauffeur is assigned, and you can follow progress in My Bookings.`}
        </p>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {editing && (
          <div className="border border-champagne-muted px-4 py-3 text-smoke text-sm font-light">
            Amending your existing booking. Update the details below and resubmit.
          </div>
        )}
        {/* Honeypot field - hidden from real users, bots will fill it */}
        <div className="absolute opacity-0 -z-10" aria-hidden="true" tabIndex={-1}>
          <label htmlFor="website">Website</label>
          <input
            id="website"
            name="website"
            type="text"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            autoComplete="off"
            tabIndex={-1}
          />
        </div>
        {/* Who is this booking for */}
        <FormField
          control={form.control}
          name="bookingType"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-smoke text-xs tracking-[0.2em] uppercase">
                Booking Type
              </FormLabel>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <button
                  type="button"
                  onClick={() => field.onChange("personal")}
                  className={cn(
                    "border p-4 text-left transition-all duration-500",
                    field.value === "personal"
                      ? "border-champagne"
                      : "border-border hover:border-champagne-muted"
                  )}
                >
                  <p className="text-foreground text-sm tracking-wide">Personal</p>
                  <p className="text-smoke text-xs font-light mt-1">
                    For yourself or your family.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => field.onChange("business")}
                  className={cn(
                    "border p-4 text-left transition-all duration-500",
                    field.value === "business"
                      ? "border-champagne"
                      : "border-border hover:border-champagne-muted"
                  )}
                >
                  <p className="text-foreground text-sm tracking-wide">Business</p>
                  <p className="text-smoke text-xs font-light mt-1">
                    Invoiced to a company, booked by you or a PA.
                  </p>
                </button>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {bookingType === "business" && (
          <div className="space-y-4 border border-border p-4 md:p-6">
            <h3 className="text-smoke text-xs tracking-[0.2em] uppercase font-light">Business Details</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <FormField control={form.control} name="business.company" render={({ field }) => (
                <FormItem><FormControl><Input placeholder="Company name" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="business.department" render={({ field }) => (
                <FormItem><FormControl><Input placeholder="Department (optional)" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="business.clients" render={({ field }) => (
              <FormItem><FormControl><Input placeholder="Client names (optional)" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid md:grid-cols-2 gap-4">
              <FormField control={form.control} name="business.pa_name" render={({ field }) => (
                <FormItem><FormControl><Input placeholder="PA name (optional)" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="business.pa_contact" render={({ field }) => (
                <FormItem><FormControl><Input placeholder="PA phone or email (optional)" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="business.invoice_address" render={({ field }) => (
              <FormItem><FormControl><Input placeholder="Invoice address" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <p className="text-smoke/70 text-xs font-light">We remember these for your next booking.</p>
          </div>
        )}

        {/* Vehicle Selection (not needed when we drive the client's own car) */}
        {journeyType !== "client_car" && (
        <FormField
          control={form.control}
          name="vehicle"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-smoke text-xs tracking-[0.2em] uppercase">
                Select Vehicle
              </FormLabel>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                {vehicles.map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    onClick={() => field.onChange(v.name)}
                    className={cn(
                      "relative overflow-hidden group cursor-pointer transition-all duration-500",
                      "border",
                      selectedVehicle === v.name
                        ? "border-champagne"
                        : "border-border hover:border-champagne-muted"
                    )}
                  >
                    <div className="aspect-[4/3] overflow-hidden">
                      <img
                        src={v.image}
                        alt={v.name}
                        className={cn(
                          "w-full h-full object-cover transition-all duration-500",
                          selectedVehicle === v.name
                            ? "opacity-90 scale-105"
                            : "opacity-50 group-hover:opacity-70",
                          v.name === "JetClass" && "scale-x-[-1]"
                        )}
                      />
                    </div>
                    <div
                      className={cn(
                        "absolute inset-0 flex items-end justify-center pb-3 bg-gradient-to-t from-black/70 to-transparent"
                      )}
                    >
                      <span
                        className={cn(
                          "text-[10px] tracking-[0.2em] uppercase font-light transition-colors duration-300",
                          selectedVehicle === v.name
                            ? "text-champagne"
                            : "text-foreground/70"
                        )}
                      >
                        {v.name}
                      </span>
                    </div>
                    {selectedVehicle === v.name && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-champagne/20 border border-champagne flex items-center justify-center">
                        <Check className="w-3 h-3 text-champagne" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        )}

        {/* Contact Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-smoke text-xs tracking-[0.2em] uppercase">
                  Full Name
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="Your name"
                    className="bg-transparent border-border focus:border-champagne-muted rounded-none h-11 text-foreground placeholder:text-muted-foreground text-sm"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-smoke text-xs tracking-[0.2em] uppercase">
                  Email
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="email"
                    placeholder="your@email.com"
                    className="bg-transparent border-border focus:border-champagne-muted rounded-none h-11 text-foreground placeholder:text-muted-foreground text-sm"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-smoke text-xs tracking-[0.2em] uppercase">
                  Phone
                </FormLabel>
                <div className="flex gap-2">
                  <CountryCodeSelect value={countryCode} onChange={setCountryCode} />
                  <FormControl>
                    <Input
                      {...field}
                      type="tel"
                      placeholder="7123 456789"
                      className="bg-transparent border-border focus:border-champagne-muted rounded-none h-11 text-foreground placeholder:text-muted-foreground text-sm flex-1"
                    />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="travelDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-smoke text-xs tracking-[0.2em] uppercase">
                  Date of Travel
                </FormLabel>
                <Popover>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-light rounded-none h-11 bg-transparent border-border hover:border-champagne-muted hover:bg-transparent",
                          !field.value && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4 opacity-50" />
                        {field.value ? (
                          format(field.value, "PPP")
                        ) : (
                          <span>Select date</span>
                        )}
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={field.onChange}
                      disabled={(date) => date < startOfToday()}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="collectionTime"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-smoke text-xs tracking-[0.2em] uppercase">
                  Pickup Time
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="time"
                    className="bg-transparent border-border focus:border-champagne-muted rounded-none h-11 text-foreground placeholder:text-muted-foreground text-sm"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Journey Type */}
        <FormField
          control={form.control}
          name="journeyType"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-smoke text-xs tracking-[0.2em] uppercase">
                Journey Type
              </FormLabel>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                <button
                  type="button"
                  onClick={() => field.onChange("destination")}
                  className={cn(
                    "border p-4 text-left transition-all duration-500",
                    field.value === "destination"
                      ? "border-champagne"
                      : "border-border hover:border-champagne-muted"
                  )}
                >
                  <p className="text-foreground text-sm tracking-wide">To a Destination</p>
                  <p className="text-smoke text-xs font-light mt-1">
                    Pickup to dropoff, with optional stops en route.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => field.onChange("hourly")}
                  className={cn(
                    "border p-4 text-left transition-all duration-500",
                    field.value === "hourly"
                      ? "border-champagne"
                      : "border-border hover:border-champagne-muted"
                  )}
                >
                  <p className="text-foreground text-sm tracking-wide">By the Hour</p>
                  <p className="text-smoke text-xs font-light mt-1">
                    Your chauffeur at your direction. Minimum {MIN_HIRE_HOURS} hours.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => field.onChange("client_car")}
                  className={cn(
                    "border p-4 text-left transition-all duration-500",
                    field.value === "client_car"
                      ? "border-champagne"
                      : "border-border hover:border-champagne-muted"
                  )}
                >
                  <p className="text-foreground text-sm tracking-wide">Drive My Car</p>
                  <p className="text-smoke text-xs font-light mt-1">
                    A chauffeur for your own vehicle, with you aboard or moving it for you.
                  </p>
                </button>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {journeyType === "hourly" && (
          <FormField
            control={form.control}
            name="asDirectedHours"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-smoke text-xs tracking-[0.2em] uppercase">
                  Hire Duration
                </FormLabel>
                <div className="grid grid-cols-3 md:grid-cols-5 gap-3 mt-3">
                  {Array.from(
                    { length: MAX_HIRE_HOURS - MIN_HIRE_HOURS + 1 },
                    (_, i) => MIN_HIRE_HOURS + i
                  ).map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => field.onChange(String(h))}
                      className={cn(
                        "border py-3 text-sm transition-all duration-500",
                        field.value === String(h)
                          ? "border-champagne text-foreground"
                          : "border-border text-smoke hover:border-champagne-muted"
                      )}
                    >
                      {h} hrs
                    </button>
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {journeyType === "client_car" && (
          <div className="space-y-4 border border-border p-4 md:p-6">
            <h3 className="text-smoke text-xs tracking-[0.2em] uppercase font-light">Your Vehicle</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <FormField control={form.control} name="clientCar.make_model" render={({ field }) => (
                <FormItem><FormControl><Input placeholder="Make and model" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="clientCar.registration" render={({ field }) => (
                <FormItem><FormControl><Input placeholder="Registration" className="uppercase" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField
              control={form.control}
              name="clientCar.client_travelling"
              render={({ field }) => (
                <FormItem>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => field.onChange(true)}
                      className={cn(
                        "border py-3 text-sm transition-all duration-500",
                        field.value ? "border-champagne text-foreground" : "border-border text-smoke hover:border-champagne-muted"
                      )}
                    >
                      I am travelling in it
                    </button>
                    <button
                      type="button"
                      onClick={() => field.onChange(false)}
                      className={cn(
                        "border py-3 text-sm transition-all duration-500",
                        !field.value ? "border-champagne text-foreground" : "border-border text-smoke hover:border-champagne-muted"
                      )}
                    >
                      Move it for me
                    </button>
                  </div>
                </FormItem>
              )}
            />
            <p className="text-smoke/70 text-xs font-light">
              Your chauffeur collects the car from the pickup address below and takes it to the destination.
            </p>
          </div>
        )}

        {/* Pickup Address */}
        <div className="space-y-4">
          <h3 className="text-smoke text-xs tracking-[0.2em] uppercase font-light">
            {journeyType === "client_car" ? "Where the car is" : "Pickup Location"}
          </h3>
          <LocationSearch
            placeholder="Search pickup: place, airport, restaurant or postcode"
            onSelect={applyPlace("pickupAddress")}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField control={form.control} name="pickupAddress.line1" render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input {...field} placeholder="Address Line 1" className="bg-transparent border-border focus:border-champagne-muted rounded-none h-11 text-foreground placeholder:text-muted-foreground text-sm" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="pickupAddress.line2" render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input {...field} placeholder="Address Line 2 (optional)" className="bg-transparent border-border focus:border-champagne-muted rounded-none h-11 text-foreground placeholder:text-muted-foreground text-sm" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="pickupAddress.town" render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input {...field} placeholder="Town / City" className="bg-transparent border-border focus:border-champagne-muted rounded-none h-11 text-foreground placeholder:text-muted-foreground text-sm" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="pickupAddress.postcode" render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input {...field} placeholder="Postcode" className="bg-transparent border-border focus:border-champagne-muted rounded-none h-11 text-foreground placeholder:text-muted-foreground text-sm" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </div>

        {journeyType !== "hourly" && (
          <>
            {/* Stops en route */}
            {stopFields.map((stopField, i) => (
              <div key={stopField.id} className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-smoke text-xs tracking-[0.2em] uppercase font-light">
                    Stop {i + 1}
                  </h3>
                  <button
                    type="button"
                    onClick={() => removeStop(i)}
                    aria-label={`Remove stop ${i + 1}`}
                    className="text-smoke hover:text-foreground transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <LocationSearch
                  placeholder="Search stop: place, restaurant or postcode"
                  onSelect={applyPlace(`viaStops.${i}`)}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField control={form.control} name={`viaStops.${i}.line1`} render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input {...field} placeholder="Address Line 1" className="bg-transparent border-border focus:border-champagne-muted rounded-none h-11 text-foreground placeholder:text-muted-foreground text-sm" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`viaStops.${i}.line2`} render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input {...field} placeholder="Address Line 2 (optional)" className="bg-transparent border-border focus:border-champagne-muted rounded-none h-11 text-foreground placeholder:text-muted-foreground text-sm" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`viaStops.${i}.town`} render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input {...field} placeholder="Town / City" className="bg-transparent border-border focus:border-champagne-muted rounded-none h-11 text-foreground placeholder:text-muted-foreground text-sm" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`viaStops.${i}.postcode`} render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input {...field} placeholder="Postcode" className="bg-transparent border-border focus:border-champagne-muted rounded-none h-11 text-foreground placeholder:text-muted-foreground text-sm" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>
            ))}

        {/* Dropoff Address */}
        <div className="space-y-4">
          <h3 className="text-smoke text-xs tracking-[0.2em] uppercase font-light">
            {journeyType === "client_car" ? "Where it needs to go" : "Dropoff Location"}
          </h3>
          <LocationSearch
            placeholder="Search dropoff: place, airport, restaurant or postcode"
            onSelect={applyPlace("dropoffAddress")}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField control={form.control} name="dropoffAddress.line1" render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input {...field} placeholder="Address Line 1" className="bg-transparent border-border focus:border-champagne-muted rounded-none h-11 text-foreground placeholder:text-muted-foreground text-sm" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="dropoffAddress.line2" render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input {...field} placeholder="Address Line 2 (optional)" className="bg-transparent border-border focus:border-champagne-muted rounded-none h-11 text-foreground placeholder:text-muted-foreground text-sm" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="dropoffAddress.town" render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input {...field} placeholder="Town / City" className="bg-transparent border-border focus:border-champagne-muted rounded-none h-11 text-foreground placeholder:text-muted-foreground text-sm" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="dropoffAddress.postcode" render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input {...field} placeholder="Postcode" className="bg-transparent border-border focus:border-champagne-muted rounded-none h-11 text-foreground placeholder:text-muted-foreground text-sm" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </div>

            {stopFields.length < MAX_STOPS && (
              <button
                type="button"
                onClick={() =>
                  appendStop({
                    line1: "",
                    line2: "",
                    town: "",
                    postcode: "",
                    country: "United Kingdom",
                  })
                }
                className="w-full border border-dashed border-border hover:border-champagne-muted text-smoke hover:text-foreground transition-colors text-xs tracking-[0.2em] uppercase py-3"
              >
                + Add Another Stop
              </button>
            )}
          </>
        )}

        {/* Return journey: a second car later, rather than holding the first */}
        {journeyType !== "hourly" && !editing && (
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="returnJourney"
              render={({ field }) => (
                <FormItem>
                  <button
                    type="button"
                    onClick={() => field.onChange(!field.value)}
                    aria-pressed={field.value}
                    className={cn(
                      "w-full border p-4 text-left transition-all duration-500 flex items-start gap-4",
                      field.value ? "border-champagne" : "border-border hover:border-champagne-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 w-5 h-5 flex-none border flex items-center justify-center transition-colors",
                        field.value ? "border-champagne bg-champagne" : "border-champagne-muted"
                      )}
                    >
                      {field.value && <Check className="w-3.5 h-3.5 text-background" />}
                    </span>
                    <span>
                      <span className="block text-foreground text-sm tracking-wide">
                        This is a return journey
                      </span>
                      <span className="block text-smoke text-xs font-light mt-1">
                        We will send a car back the other way at a time you choose, so you do not
                        need to make a second booking or hold a chauffeur in between.
                      </span>
                    </span>
                  </button>
                  <FormMessage />
                </FormItem>
              )}
            />

            {returnJourney && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border border-border p-4 md:p-6">
                <FormField
                  control={form.control}
                  name="returnDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-smoke text-xs tracking-[0.2em] uppercase">
                        Return Date
                      </FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-left font-light rounded-none h-11 bg-transparent border-border hover:border-champagne-muted hover:bg-transparent",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4 opacity-50" />
                              {field.value ? format(field.value, "PPP") : <span>Select date</span>}
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={field.onChange}
                            disabled={(date) => date < startOfToday()}
                            initialFocus
                            className={cn("p-3 pointer-events-auto")}
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="returnTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-smoke text-xs tracking-[0.2em] uppercase">
                        Return Time
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="time"
                          className="bg-transparent border-border focus:border-champagne-muted rounded-none h-11 text-foreground placeholder:text-muted-foreground text-sm"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <p className="text-smoke/70 text-xs font-light md:col-span-2">
                  The return runs the journey the other way round, from your destination back to
                  your pickup address.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="passengers"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-smoke text-xs tracking-[0.2em] uppercase">
                  Passengers
                </FormLabel>
                <div className="flex items-center gap-3 h-11 border border-border px-3">
                  <Users className="w-4 h-4 text-champagne shrink-0" />
                  <button
                    type="button"
                    onClick={() => field.onChange(Math.max(1, field.value - 1))}
                    className="w-7 h-7 flex items-center justify-center text-smoke hover:text-champagne transition-colors"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-foreground text-sm w-6 text-center tabular-nums">{field.value}</span>
                  <button
                    type="button"
                    onClick={() => field.onChange(Math.min(20, field.value + 1))}
                    className="w-7 h-7 flex items-center justify-center text-smoke hover:text-champagne transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="bags"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-smoke text-xs tracking-[0.2em] uppercase">
                  Luggage
                </FormLabel>
                <div className="flex items-center gap-3 h-11 border border-border px-3">
                  <Luggage className="w-4 h-4 text-champagne shrink-0" />
                  <button
                    type="button"
                    onClick={() => field.onChange(Math.max(0, field.value - 1))}
                    className="w-7 h-7 flex items-center justify-center text-smoke hover:text-champagne transition-colors"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-foreground text-sm w-6 text-center tabular-nums">{field.value}</span>
                  <button
                    type="button"
                    onClick={() => field.onChange(Math.min(30, field.value + 1))}
                    className="w-7 h-7 flex items-center justify-center text-smoke hover:text-champagne transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Children: ages decide the seats we fit */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-smoke text-xs tracking-[0.2em] uppercase">
              Children travelling
            </p>
            {childFields.length < MAX_CHILDREN && (
              <button
                type="button"
                onClick={() => appendChild({ age: 5 })}
                className="text-champagne hover:text-foreground transition-colors text-xs tracking-[0.15em] uppercase"
              >
                + Add child
              </button>
            )}
          </div>
          {childFields.length === 0 ? (
            <p className="text-smoke/70 text-xs font-light">
              Add any children so we can fit the right seats.
            </p>
          ) : (
            <div className="space-y-2">
              {childFields.map((child, i) => (
                <div key={child.id} className="flex items-center gap-3 border border-border px-4 py-2">
                  <Baby className="w-4 h-4 text-champagne flex-none" />
                  <span className="text-smoke text-xs tracking-[0.15em] uppercase flex-none">Age</span>
                  <FormField
                    control={form.control}
                    name={`children.${i}.age`}
                    render={({ field }) => (
                      <FormItem className="flex-none">
                        <FormControl>
                          <select
                            value={field.value}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                            className="bg-transparent border border-border text-foreground text-sm px-2 py-1 focus:outline-none focus:border-champagne"
                          >
                            {Array.from({ length: 18 }, (_, a) => (
                              <option key={a} value={a} className="bg-background">
                                {a === 0 ? "Under 1" : a}
                              </option>
                            ))}
                          </select>
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <span className="text-smoke text-xs font-light flex-1">
                    {seatFor(childAges?.[i]?.age ?? 0)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeChild(i)}
                    aria-label="Remove child"
                    className="text-smoke hover:text-foreground transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <p className="text-smoke/70 text-xs font-light">
                Please count children in the passenger total above.
              </p>
            </div>
          )}
        </div>

        {/* Notes */}
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-smoke text-xs tracking-[0.2em] uppercase">
                Notes for your chauffeur (optional)
              </FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Flight number, meeting point, luggage, anything else we should know."
                  rows={3}
                  maxLength={MAX_NOTES}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="pt-4">
          <Button
            type="submit"
            variant="apex"
            size="apex"
            disabled={isSubmitting}
            className="w-full md:w-auto"
          >
            {isSubmitting ? "Sending..." : editing ? "Update Booking" : "Submit Enquiry"}
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default BookingForm;
