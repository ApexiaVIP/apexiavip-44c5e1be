import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Users, Briefcase } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { vehicles } from "@/data/vehicles";

const VehicleDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const vehicle = vehicles.find((v) => v.slug === slug);

  if (!vehicle) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-smoke text-sm tracking-widest uppercase mb-6">Vehicle not found</p>
          <Link to="/" className="text-champagne text-xs tracking-[0.2em] uppercase hover:text-foreground transition-colors">
            Return Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-32 pb-24">
        <div className="container mx-auto px-8">
          <div className="max-w-5xl mx-auto">
            {/* Back link */}
            <Link
              to="/#vehicles"
              className="inline-flex items-center gap-2 text-smoke hover:text-foreground transition-colors duration-500 text-xs tracking-[0.2em] uppercase mb-12"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Fleet
            </Link>

            {/* Vehicle name */}
            <h1 className="font-display text-4xl md:text-5xl text-foreground tracking-tight mb-16" style={{ fontStretch: "condensed" }}>
              {vehicle.name}
            </h1>

            {/* Vehicle images */}
            {vehicle.gallery && vehicle.gallery.length > 0 ? (
              <div className="mb-20">
                {/* Hero image */}
                <div className="relative overflow-hidden mb-2">
                  <img
                    src={vehicle.gallery[0]}
                    alt={`${vehicle.name} hero`}
                    className="w-full h-72 md:h-[28rem] object-cover object-center"
                  />
                  <div className="absolute inset-0 bg-background/25 pointer-events-none" />
                </div>

                {/* Supporting grid */}
                {vehicle.gallery.length > 1 && (
                  <div className="grid grid-cols-2 gap-2">
                    {vehicle.gallery.slice(1).map((img, i) => (
                      <div key={i} className="relative overflow-hidden">
                        <img
                          src={img}
                          alt={`${vehicle.name} detail ${i + 1}`}
                          className="w-full h-44 md:h-60 object-cover object-center"
                        />
                        <div className="absolute inset-0 bg-background/25 pointer-events-none" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="relative overflow-hidden mb-2">
                  <img
                    src={vehicle.image}
                    alt={`${vehicle.name} exterior`}
                    className={`w-full h-72 md:h-[28rem] object-cover ${vehicle.objectPos} ${vehicle.mirrored ? "scale-x-[-1]" : ""}`}
                  />
                  <div className="absolute inset-0 bg-background/25 pointer-events-none" />
                </div>
                <div className="relative overflow-hidden mb-20">
                  <img
                    src={vehicle.interiorImage}
                    alt={`${vehicle.name} interior`}
                    className="w-full h-64 md:h-96 object-cover object-center"
                  />
                  <div className="absolute inset-0 bg-background/25 pointer-events-none" />
                </div>
              </>
            )}

            {/* Specs & Features */}
            <div className="grid md:grid-cols-2 gap-16 mb-20">
              {/* Quick specs */}
              <div>
                <p className="text-champagne text-xs tracking-[0.4em] uppercase mb-8">Specifications</p>
                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <Users className="w-5 h-5 text-champagne" />
                    <span className="text-foreground text-sm tracking-wider">
                      Up to {vehicle.passengers} passengers
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <Briefcase className="w-5 h-5 text-champagne" />
                    <span className="text-foreground text-sm tracking-wider">
                      Up to {vehicle.luggage} luggage items
                    </span>
                  </div>
                </div>
              </div>

              {/* Features list */}
              <div>
                <p className="text-champagne text-xs tracking-[0.4em] uppercase mb-8">Features</p>
                <ul className="space-y-4">
                  {vehicle.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-3">
                      <div className="w-1 h-1 bg-champagne rounded-full" />
                      <span className="text-smoke text-sm tracking-wider">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* CTA */}
            <div className="text-center">
              <Link
                to={`/?vehicle=${encodeURIComponent(vehicle.name)}#contact`}
                className="inline-block border border-champagne text-champagne hover:bg-champagne hover:text-background px-12 py-4 text-xs tracking-[0.3em] uppercase transition-all duration-500"
              >
                Book This Vehicle
              </Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default VehicleDetail;
