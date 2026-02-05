const Services = () => {
  return (
    <section id="services" className="py-32 bg-background">
      <div className="container mx-auto px-8">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-16 md:gap-24">
            <div className="space-y-6">
              <p className="text-champagne text-xs tracking-[0.4em] uppercase">
                Services
              </p>
              <h2 className="font-display text-3xl md:text-4xl font-light tracking-wider text-foreground">
                Complete Protection
              </h2>
            </div>
            
            <div className="space-y-8">
              <div className="space-y-4">
                <h3 className="text-foreground text-sm tracking-[0.15em] uppercase">
                  Executive Transport
                </h3>
                <p className="text-smoke text-sm font-light leading-relaxed">
                  Door-to-door service with trained protection officers. 
                  All personnel are vetted to the highest standards.
                </p>
              </div>
              
              <div className="h-px bg-border" />
              
              <div className="space-y-4">
                <h3 className="text-foreground text-sm tracking-[0.15em] uppercase">
                  Advance Planning
                </h3>
                <p className="text-smoke text-sm font-light leading-relaxed">
                  Comprehensive route assessment and contingency protocols. 
                  Coordination with local authorities as required.
                </p>
              </div>
              
              <div className="h-px bg-border" />
              
              <div className="space-y-4">
                <h3 className="text-foreground text-sm tracking-[0.15em] uppercase">
                  Global Reach
                </h3>
                <p className="text-smoke text-sm font-light leading-relaxed">
                  Established partnerships across major cities worldwide. 
                  Seamless service regardless of destination.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Services;
