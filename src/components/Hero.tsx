import heroVehicle from "@/assets/hero-vehicle.jpg";

const Hero = () => {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0">
        <img 
          src={heroVehicle} 
          alt="" 
          className="w-full h-full object-cover opacity-70"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-background/40" />
      </div>
      
      {/* Content */}
      <div className="relative z-10 container mx-auto px-8 text-center">
        <div className="max-w-3xl mx-auto space-y-8">
          <div className="animate-fade-in-slow">
            <p className="text-smoke text-xs tracking-[0.4em] uppercase mb-6">
              Est. UK
            </p>
            <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-light tracking-wider text-foreground leading-tight">
              APEXIA VIP
            </h1>
            <div className="h-px w-24 mx-auto my-6 bg-champagne-muted" />
            <p className="text-smoke text-sm md:text-base tracking-[0.2em] font-light">
              Discretion is our standard
            </p>
          </div>
        </div>
      </div>
      
      {/* Subtle scroll indicator */}
      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 animate-fade-in">
        <div className="w-px h-16 bg-gradient-to-b from-champagne-muted to-transparent" />
      </div>
    </section>
  );
};

export default Hero;
