const Footer = () => {
  return (
    <footer className="py-12 bg-background border-t border-border">
      <div className="container mx-auto px-8">
        <div className="flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0">
          <div className="flex items-center space-x-3">
            <span className="font-display text-lg tracking-[0.15em] text-foreground">
              APEX
            </span>
          </div>
          
          <p className="text-smoke text-xs tracking-wider">
            © 2024 Apex Limousine Services. All enquiries confidential.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
