import Header from "@/components/Header";
import Hero from "@/components/Hero";
import Fleet from "@/components/Fleet";
import Services from "@/components/Services";
import Contact from "@/components/Contact";
import Footer from "@/components/Footer";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <Hero />
        <Fleet />
        <Services />
        <Contact />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
