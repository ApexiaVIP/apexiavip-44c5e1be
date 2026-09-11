import { useSearchParams } from "react-router-dom";
import MemberLayout from "@/components/MemberLayout";
import MembersGate from "@/components/MembersGate";
import BookingForm from "@/components/BookingForm";

/**
 * The booking form on its own screen. Takes the same query parameters the
 * form always has: ?vehicle=<name> to preselect a car, ?edit=<reference>
 * to amend an existing booking.
 */
const Book = () => {
  const [searchParams] = useSearchParams();
  const amending = !!searchParams.get("edit");

  return (
    <MemberLayout>
      <div className="container mx-auto px-8 pb-16 max-w-3xl">
        <div className="text-center mb-12">
          <p className="text-champagne text-xs tracking-[0.4em] uppercase mb-3">
            {amending ? "Amend" : "Book"}
          </p>
          <h1 className="font-display text-3xl md:text-4xl font-light tracking-wider text-foreground">
            {amending ? "Change Your Booking" : "Book a Chauffeur"}
          </h1>
        </div>
        <MembersGate>
          <BookingForm />
        </MembersGate>
      </div>
    </MemberLayout>
  );
};

export default Book;
