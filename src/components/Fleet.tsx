const Fleet = () => {
  const vehicles = [
    { registration: "APX 1", description: "Executive Saloon" },
    { registration: "APX 2", description: "Extended Wheelbase" },
    { registration: "APX 3", description: "Armoured SUV" },
  ];

  return (
    <section id="fleet" className="py-32 bg-charcoal">
      <div className="container mx-auto px-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-20">
            <p className="text-champagne text-xs tracking-[0.4em] uppercase mb-4">
              Our Fleet
            </p>
            <h2 className="font-display text-3xl md:text-4xl font-light tracking-wider text-foreground">
              Select Vehicles
            </h2>
          </div>
          
          <div className="space-y-1">
            {vehicles.map((vehicle, index) => (
              <div 
                key={vehicle.registration}
                className="group py-8 border-t border-border hover:bg-background/30 transition-all duration-500 cursor-default"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div className="flex items-center justify-between px-4">
                  <span className="font-display text-2xl md:text-3xl tracking-widest text-foreground group-hover:text-champagne transition-colors duration-500">
                    {vehicle.registration}
                  </span>
                  <span className="text-smoke text-xs tracking-[0.2em] uppercase">
                    {vehicle.description}
                  </span>
                </div>
              </div>
            ))}
            <div className="border-t border-border" />
          </div>
          
          <p className="text-center text-smoke text-xs tracking-wider mt-16">
            Additional vehicles available upon request
          </p>
        </div>
      </div>
    </section>
  );
};

export default Fleet;
