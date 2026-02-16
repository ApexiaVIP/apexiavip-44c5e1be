import apexiaLogo from "@/assets/apexia-logo.jpg";

const Header = () => {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md">
      <div className="container mx-auto px-8 py-6">
        <nav className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img src={apexiaLogo} alt="Apexia VIP" className="h-10 w-auto" />
          </div>
          
          <div className="hidden md:flex items-center space-x-12">
            <a 
              href="#services" 
              className="text-smoke hover:text-foreground transition-colors duration-500 text-xs tracking-[0.2em] uppercase"
            >
              Services
            </a>
            <a 
              href="#contact" 
              className="text-smoke hover:text-foreground transition-colors duration-500 text-xs tracking-[0.2em] uppercase"
            >
              Contact
            </a>
          </div>
        </nav>
      </div>
    </header>
  );
};

export default Header;
