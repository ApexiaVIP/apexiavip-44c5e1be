import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import Vehicles from "@/components/Vehicles";
import Services from "@/components/Services";
import Contact from "@/components/Contact";
import Footer from "@/components/Footer";

const Index = () => {
  const location = useLocation();

  useEffect(() => {
    if (location.hash) {
      const el = document.querySelector(location.hash);
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: "smooth" }), 100);
      }
    }
  }, [location]);
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <Hero />
        <Vehicles />
        <Services />
        <Contact />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
