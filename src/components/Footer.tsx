import apexiaLogo from "@/assets/apexia-logo.jpg";

const Footer = () => {
  return (
    <footer className="py-12 bg-background border-t border-border">
      <div className="container mx-auto px-8">
        <div className="flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0">
          <div className="flex items-center space-x-3">
            <img src={apexiaLogo} alt="Apexia VIP" className="h-16 w-auto" />
          </div>
          
          <p className="text-smoke text-xs tracking-wider">
            Apexia VIP Ltd. All enquiries confidential.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
