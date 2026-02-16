import { Link } from "react-router-dom";
import { vehicles } from "@/data/vehicles";

const Vehicles = () => {
  return (
    <section id="vehicles" className="py-32 bg-background">
      <div className="container mx-auto px-8">
        <div className="max-w-5xl mx-auto">
          <div className="mb-16">
            <p className="text-champagne text-xs tracking-[0.4em] uppercase">
              Fleet
            </p>
          </div>

          <div className="space-y-12">
            {vehicles.map((vehicle) => (
              <Link to={`/fleet/${vehicle.slug}`} key={vehicle.slug} className="group block">
                <div className="overflow-hidden relative">
                  <img
                    src={vehicle.image}
                    alt={`${vehicle.name} executive transport`}
                    className={`w-full h-48 md:h-64 object-cover ${vehicle.objectPos} opacity-70 group-hover:opacity-90 transition-opacity duration-700 ${vehicle.mirrored ? "scale-x-[-1]" : ""}`}
                    loading="lazy"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="border border-champagne/60 text-champagne bg-background/40 backdrop-blur-sm px-6 py-2.5 text-[10px] tracking-[0.3em] uppercase opacity-0 group-hover:opacity-100 transition-all duration-500">
                      View Details
                    </span>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-foreground text-sm tracking-[0.15em] uppercase font-light">
                    {vehicle.name}
                  </p>
                  <div className="h-px flex-1 mx-6 bg-border" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Vehicles;
