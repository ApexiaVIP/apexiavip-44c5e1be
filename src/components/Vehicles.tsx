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
              <div key={vehicle.name} className="group">
                <div className="overflow-hidden">
                  <img
                    src={vehicle.image}
                    alt={`${vehicle.name} executive transport`}
                    className={`w-full h-48 md:h-64 object-cover object-center opacity-70 group-hover:opacity-90 transition-opacity duration-700 ${vehicle.name === "JetClass" ? "scale-x-[-1]" : ""}`}
                    loading="lazy"
                  />
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-foreground text-sm tracking-[0.15em] uppercase font-light">
                    {vehicle.name}
                  </p>
                  <div className="h-px flex-1 mx-6 bg-border" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Vehicles;
