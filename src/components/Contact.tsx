import { Button } from "@/components/ui/button";

const Contact = () => {
  return (
    <section id="contact" className="py-32 bg-charcoal">
      <div className="container mx-auto px-8">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-champagne text-xs tracking-[0.4em] uppercase mb-4">
            Contact
          </p>
          <h2 className="font-display text-3xl md:text-4xl font-light tracking-wider text-foreground mb-8">
            By Appointment
          </h2>
          <p className="text-smoke text-sm font-light leading-relaxed mb-12">
            We work exclusively with established clients and qualified referrals. 
            All enquiries are handled with complete discretion.
          </p>
          
          <Button variant="apex" size="apex">
            Make an Enquiry
          </Button>
          
          <div className="mt-16 pt-16 border-t border-border">
            <p className="text-smoke text-xs tracking-wider">
              UK • Dubai • Monaco • Marbella • Miami • NYC
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Contact;
