import { useState, useCallback } from "react";
import CountryCodeSelect from "@/components/CountryCodeSelect";
import { format } from "date-fns";
import { CalendarIcon, Check, Users, Luggage, Minus, Plus } from "lucide-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
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

const bookingSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().email("Invalid email address").max(255),
  phone: z.string().trim().min(1, "Phone number is required").max(30),
  travelDate: z.date({ required_error: "Please select a travel date" }),
  vehicle: z.string().min(1, "Please select a vehicle"),
  passengers: z.number().min(1, "At least 1 passenger").max(20),
  bags: z.number().min(0).max(30),
});

type BookingFormValues = z.infer<typeof bookingSchema>;

const BookingForm = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [countryCode, setCountryCode] = useState("+44");
  const [calendarOpen, setCalendarOpen] = useState(false);

  const form = useForm<BookingFormValues>({
    resolver: zodResolver(bookingSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      vehicle: "",
      passengers: 1,
      bags: 1,
    },
  });

  const selectedVehicle = form.watch("vehicle");

  const onSubmit = async (data: BookingFormValues) => {
    setIsSubmitting(true);
    try {
      const { data: result, error } = await supabase.functions.invoke(
        "send-booking",
        {
          body: {
            name: data.name,
            email: data.email,
            phone: `${countryCode} ${data.phone}`,
            travelDate: format(data.travelDate, "PPP"),
            vehicle: data.vehicle,
            passengers: data.passengers,
            bags: data.bags,
            website: honeypot,
          },
        }
      );

      if (error) throw error;

      setSubmitted(true);
      toast({
        title: "Enquiry Sent",
        description: "We will be in touch shortly.",
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
          Enquiry Received
        </h3>
        <p className="text-smoke text-sm font-light">
          We will respond within 24 hours.
        </p>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
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
                <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
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
                      onSelect={(date) => {
                        field.onChange(date);
                        setCalendarOpen(false);
                      }}
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
        </div>

        {/* Passengers & Bags */}
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
            {isSubmitting ? "Sending..." : "Submit Enquiry"}
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default BookingForm;
