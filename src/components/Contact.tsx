import BookingForm from "@/components/BookingForm";
import MembersGate from "@/components/MembersGate";

const Contact = () => {
  return (
    <section id="contact" className="py-32 bg-charcoal">
      <div className="container mx-auto px-8">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-champagne text-xs tracking-[0.4em] uppercase mb-4">
              Book
            </p>
            <h2 className="font-display text-3xl md:text-4xl font-light tracking-wider text-foreground mb-8">
              Make an Enquiry
            </h2>
            <p className="text-smoke text-sm font-light leading-relaxed">
              All enquiries are handled with complete discretion.
            </p>
          </div>

          <MembersGate>
            <BookingForm />
          </MembersGate>

          <div className="mt-20 pt-16 border-t border-border text-center">
            <p className="text-smoke text-xs tracking-wider">
              UK • EUROPE • UAE • USA
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Contact;
