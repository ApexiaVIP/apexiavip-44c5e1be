import { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import CountryCodeSelect from "@/components/CountryCodeSelect";
import { format } from "date-fns";
import { CalendarIcon, Check, Users, Luggage, Minus, Plus, X } from "lucide-react";
import { z } from "zod";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export const MIN_HIRE_HOURS = 4;
export const MAX_HIRE_HOURS = 12;
const MAX_STOPS = 5;

const bookingSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100),
    email: z.string().trim().email("Invalid email address").max(255),
    phone: z.string().trim().min(1, "Phone number is required").max(30),
    travelDate: z.date({ required_error: "Please select a travel date" }),
    collectionTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Please select a pickup time"),
    vehicle: z.string().min(1, "Please select a vehicle"),
    passengers: z.number().min(1, "At least 1 passenger").max(20),
    bags: z.number().min(0).max(30),
    journeyType: z.enum(["destination", "hourly"]),
    asDirectedHours: z.string().default(""),
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
    if (v.journeyType === "destination") {
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
  const [honeypot, setHoneypot] = useState("");
  const [countryCode, setCountryCode] = useState("+44");
  const [searchParams, setSearchParams] = useSearchParams();

  const form = useForm<BookingFormValues>({
    resolver: zodResolver(bookingSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      collectionTime: "",
      vehicle: "",
      passengers: 1,
      bags: 1,
      journeyType: "destination",
      asDirectedHours: "",
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
  const journeyType = form.watch("journeyType");

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
      form.reset({
        name: data.name,
        email: data.email,
        phone: phoneMatch ? phoneMatch[2] : data.phone,
        travelDate: collection,
        collectionTime: collection
          ? `${String(collection.getHours()).padStart(2, "0")}:${String(collection.getMinutes()).padStart(2, "0")}`
          : "",
        vehicle: data.vehicle,
        passengers: data.passengers ?? 1,
        bags: data.bags ?? 0,
        journeyType: data.journey_type === "hourly" ? "hourly" : "destination",
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
            vehicle: data.vehicle,
            passengers: data.passengers,
            bags: data.bags,
            journeyType: data.journeyType,
            asDirectedHours:
              data.journeyType === "hourly" ? parseInt(data.asDirectedHours, 10) : undefined,
            pickupAddress: data.pickupAddress,
            dropoffAddress: data.journeyType === "destination" ? data.dropoffAddress : undefined,
            viaStops: data.journeyType === "destination" ? data.viaStops : [],
            website: honeypot,
          },
        }
      );

      if (error) throw error;

      setSubmitted(true);
      toast({
        title: result?.handedToOps
          ? "Changes sent to our team"
          : editing
            ? "Booking Updated"
            : "Enquiry Sent",
        description:
          result?.handedToOps
            ? result.message
            : editing
              ? "Your changes have been sent to our team."
              : "We will be in touch shortly.",
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
          {editing ? "Booking Updated" : "Enquiry Received"}
        </h3>
        <p className="text-smoke text-sm font-light">
          {editing
            ? "Your booking has been updated. You can review it in My Bookings."
            : "We will respond within 24 hours."}
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
        {/* Vehicle Selection */}
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
                      disabled={(date) => date < new Date()}
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
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

        {/* Pickup Address */}
        <div className="space-y-4">
          <h3 className="text-smoke text-xs tracking-[0.2em] uppercase font-light">Pickup Location</h3>
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

        {journeyType === "destination" && (
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
          <h3 className="text-smoke text-xs tracking-[0.2em] uppercase font-light">Dropoff Location</h3>
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
