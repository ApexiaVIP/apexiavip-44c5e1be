import { useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ShieldCheck } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CountryCodeSelect from "@/components/CountryCodeSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const applicationSchema = z.object({
  fullName: z.string().trim().min(2, "Please give your full name").max(100),
  email: z.string().trim().email("Please give a valid email address").max(255),
  phone: z.string().trim().min(6, "Please give a valid phone number").max(30),
  addressLine1: z.string().trim().min(1, "Address line 1 is required").max(200),
  addressLine2: z.string().trim().max(200).default(""),
  town: z.string().trim().min(1, "Town or city is required").max(100),
  postcode: z.string().trim().min(1, "Postcode is required").max(20),
  heardFrom: z.string().trim().max(120).default(""),
  message: z.string().trim().max(1000).default(""),
});

type ApplicationValues = z.infer<typeof applicationSchema>;

const inputClass =
  "bg-transparent border-border focus:border-champagne-muted rounded-none h-11 text-foreground placeholder:text-muted-foreground text-sm";
const labelClass = "text-smoke text-xs tracking-[0.2em] uppercase";

const Apply = () => {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [countryCode, setCountryCode] = useState("+44");
  const [honeypot, setHoneypot] = useState("");

  const form = useForm<ApplicationValues>({
    resolver: zodResolver(applicationSchema),
    defaultValues: {
      fullName: "",
      email: "",
      phone: "",
      addressLine1: "",
      addressLine2: "",
      town: "",
      postcode: "",
      heardFrom: "",
      message: "",
    },
  });

  const onSubmit = async (values: ApplicationValues) => {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("membership-application", {
        body: {
          ...values,
          phone: `${countryCode} ${values.phone}`,
          country: "United Kingdom",
          website: honeypot,
        },
      });
      if (error || data?.success === false) {
        throw new Error(data?.error ?? "");
      }
      setSubmitted(true);
    } catch (err) {
      toast({
        title: "We could not send your enquiry",
        description:
          err instanceof Error && err.message
            ? err.message
            : "Please try again, or email info@apexiavip.com.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 pt-40 md:pt-48 pb-24">
        <div className="container mx-auto px-8 max-w-2xl">
          <div className="text-center mb-12">
            <p className="text-champagne text-xs tracking-[0.4em] uppercase mb-5">Membership</p>
            <h1 className="font-display text-4xl md:text-5xl font-light tracking-wider text-foreground mb-6">
              Request an account
            </h1>
            <div className="h-px w-24 mx-auto mb-6 bg-champagne-muted" />
            <p className="text-smoke text-sm font-light leading-relaxed max-w-md mx-auto">
              Apexia VIP is an invitation-only service. Leave your details and a member of our team
              will be in touch to talk it through and, if it is a good fit, arrange your account.
            </p>
          </div>

          {submitted ? (
            <div className="text-center py-16 border border-border animate-fade-in">
              <div className="w-12 h-12 rounded-full border border-champagne-muted flex items-center justify-center mx-auto mb-6">
                <Check className="w-5 h-5 text-champagne" />
              </div>
              <h2 className="font-display text-2xl tracking-wider text-foreground mb-3">
                Enquiry Received
              </h2>
              <p className="text-smoke text-sm font-light leading-relaxed max-w-sm mx-auto">
                Thank you. We have sent you a confirmation by email, and a member of our team will be
                in touch shortly.
              </p>
              <Link
                to="/"
                className="inline-block mt-10 text-champagne hover:text-foreground transition-colors text-xs tracking-[0.2em] uppercase underline underline-offset-4"
              >
                Back to Apexia VIP
              </Link>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                {/* Hidden from people, irresistible to bots */}
                <div className="absolute opacity-0 -z-10" aria-hidden="true" tabIndex={-1}>
                  <label htmlFor="apply-website">Website</label>
                  <input
                    id="apply-website"
                    name="website"
                    type="text"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                    autoComplete="off"
                    tabIndex={-1}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="fullName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={labelClass}>Full Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Your name" className={inputClass} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={labelClass}>Email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="you@example.com"
                            className={inputClass}
                            {...field}
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
                        <FormLabel className={labelClass}>Phone</FormLabel>
                        <div className="flex gap-2">
                          <CountryCodeSelect value={countryCode} onChange={setCountryCode} />
                          <FormControl>
                            <Input
                              type="tel"
                              placeholder="7700 900123"
                              className={inputClass}
                              {...field}
                            />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-4">
                  <h2 className="text-smoke text-xs tracking-[0.2em] uppercase font-light">Address</h2>
                  <FormField
                    control={form.control}
                    name="addressLine1"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input placeholder="Address line 1" className={inputClass} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="addressLine2"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input
                            placeholder="Address line 2 (optional)"
                            className={inputClass}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="town"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input placeholder="Town or city" className={inputClass} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="postcode"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input placeholder="Postcode" className={inputClass} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <FormField
                  control={form.control}
                  name="heardFrom"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={labelClass}>How did you hear about us? (optional)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="A recommendation, an event, online"
                          className={inputClass}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="message"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={labelClass}>
                        Anything we should know? (optional)
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          rows={3}
                          placeholder="How you expect to use the service, or anything else."
                          className="bg-transparent border-border focus:border-champagne-muted rounded-none text-foreground placeholder:text-muted-foreground text-sm"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex items-start gap-3 text-smoke/70 text-xs font-light leading-relaxed">
                  <ShieldCheck className="w-4 h-4 text-champagne flex-none mt-0.5" strokeWidth={1.5} />
                  <p>
                    Your details are used only to consider your enquiry and contact you about it. We
                    never sell or share them. See our{" "}
                    <Link
                      to="/privacy"
                      className="text-champagne hover:text-foreground transition-colors underline underline-offset-4"
                    >
                      privacy notice
                    </Link>
                    .
                  </p>
                </div>

                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-none h-12 tracking-[0.2em] uppercase text-xs"
                >
                  {submitting ? "Sending..." : "Submit Enquiry"}
                </Button>

                <p className="text-smoke/60 text-xs font-light text-center">
                  Already a member?{" "}
                  <Link
                    to="/login"
                    className="text-champagne hover:text-foreground transition-colors underline underline-offset-4"
                  >
                    Sign in
                  </Link>
                </p>
              </form>
            </Form>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Apply;
