import rangeRover from "@/assets/vehicle-range-rover.jpg";
import sClass from "@/assets/vehicle-s-class.jpg";
import vClass from "@/assets/vehicle-v-class.jpg";
import jetClass from "@/assets/vehicle-jet-class.jpg";
import interiorRangeRover from "@/assets/interior-range-rover.jpg";
import interiorSClass from "@/assets/interior-s-class.jpg";
import interiorViano from "@/assets/interior-viano.jpg";
import interiorJetClass from "@/assets/interior-jetclass.jpg";

import rrSide from "@/assets/rr-side.jpg";
import rrWheel from "@/assets/rr-wheel.jpg";
import rrInterior1 from "@/assets/rr-interior-1.jpg";
import rrInterior2 from "@/assets/rr-interior-2.jpg";
import rrInterior3 from "@/assets/rr-interior-3.jpg";
import rrInterior4 from "@/assets/rr-interior-4.jpg";
import rrDashboard from "@/assets/rr-dashboard.jpg";
import rrFront from "@/assets/rr-front.jpg";

import jc7ExteriorSide from "@/assets/jc7-exterior-side.jpg";
import jc7ExteriorFront from "@/assets/jc7-exterior-front.jpg";
import jc7ExteriorRear from "@/assets/jc7-exterior-rear.jpg";
import jc7Cabin from "@/assets/jc7-cabin.jpg";
import jc7CabinRear from "@/assets/jc7-cabin-rear.jpg";
import jc7CabinAlt from "@/assets/jc7-cabin-alt.jpg";
import jc7Seats from "@/assets/jc7-seats.jpg";
import jc7Screen from "@/assets/jc7-screen.jpg";
import jc7Console from "@/assets/jc7-console.jpg";
import jc7Refreshments from "@/assets/jc7-refreshments.jpg";
import jc7Ambient from "@/assets/jc7-ambient.jpg";
import jc7Headliner from "@/assets/jc7-headliner.jpg";
import jc7Controls from "@/assets/jc7-controls.jpg";
import jc7Sill from "@/assets/jc7-sill.jpg";
import jc7Loadspace from "@/assets/jc7-loadspace.jpg";

import scFront from "@/assets/sc-front.jpg";
import scSide from "@/assets/sc-side.jpg";
import scInterior from "@/assets/sc-interior.jpg";
import scFrontTop from "@/assets/sc-front-top.jpg";

export interface Vehicle {
  slug: string;
  name: string;
  image: string;
  interiorImage: string;
  objectPos: string;
  mirrored?: boolean;
  passengers: number;
  luggage: number;
  features: string[];
  gallery?: string[];
  /** Shown under the name, for a car whose model year is worth stating */
  modelYear?: string;
  /**
   * Kept off the site. For a car that is bought but not yet delivered: the
   * page and its pictures stay ready, and nobody can reach them or see it in
   * the fleet until this comes off.
   */
  hidden?: boolean;
}

/** Everything we hold, including cars that are not on the site yet. */
export const allVehicles: Vehicle[] = [
  {
    slug: "range-rover",
    name: "Range Rover",
    image: rangeRover,
    interiorImage: interiorRangeRover,
    objectPos: "object-[center_40%]",
    passengers: 3,
    luggage: 2,
    features: [
      "Long Wheelbase",
      "Rear Executive Seating",
      "Privacy Glass",
      "Climate-Controlled Cabin",
      "Wi-Fi Connectivity",
      "USB Charging Ports",
    ],
    gallery: [rrSide, rrFront, rrWheel, rrInterior1, rrInterior2, rrInterior3, rrInterior4, rrDashboard],
  },
  {
    slug: "s-class",
    name: "S-Class",
    image: sClass,
    interiorImage: interiorSClass,
    objectPos: "object-center",
    passengers: 3,
    luggage: 2,
    features: [
      "Rear Executive Seating",
      "Ambient Interior Lighting",
      "Privacy Glass",
      "Heated & Ventilated Seats",
      "Wi-Fi Connectivity",
      "Burmester Sound System",
    ],
    gallery: [scFront, scSide, scInterior, scFrontTop],
  },
  {
    slug: "viano",
    name: "Viano",
    image: vClass,
    interiorImage: interiorViano,
    objectPos: "object-center",
    passengers: 6,
    luggage: 4,
    features: [
      "Luxury MPV Configuration",
      "Conference-Style Seating",
      "Privacy Glass",
      "Extended Luggage Capacity",
      "Wi-Fi Connectivity",
      "USB Charging Ports",
    ],
  },
  {
    slug: "jetclass-7-seat",
    name: "JetClass Seven",
    modelYear: "2026/2027",
    // Not delivered yet, so not on the site. Take this line out on the day
    // it arrives and the page is live again exactly as it is.
    hidden: true,
    image: jc7ExteriorFront,
    interiorImage: jc7Cabin,
    objectPos: "object-center",
    passengers: 7,
    luggage: 4,
    features: [
      "Seven Seats in Silk Beige Hide",
      "Reclining Captain Chairs",
      "Panoramic Roof and Starlight Headliner",
      "Rear Entertainment Screen",
      "Chilled Refreshment Console",
      "Cut Glass Barware",
      "Ambient Cabin Lighting",
      "Wi-Fi Connectivity",
    ],
    gallery: [
      jc7ExteriorSide, jc7ExteriorFront, jc7ExteriorRear,
      jc7CabinRear, jc7CabinAlt, jc7Seats,
      jc7Screen, jc7Console, jc7Refreshments,
      jc7Ambient, jc7Headliner, jc7Controls,
      jc7Sill, jc7Loadspace,
    ],
  },
  {
    slug: "jetclass",
    name: "JetClass",
    image: jetClass,
    interiorImage: interiorJetClass,
    objectPos: "object-center",
    mirrored: true,
    passengers: 4,
    luggage: 3,
    features: [
      "Private Jet-Inspired Cabin",
      "Reclining Captain Seats",
      "Privacy Partition",
      "Premium Sound System",
      "Wi-Fi Connectivity",
      "Refreshment Console",
    ],
  },
];

/** What the public sees. Anything still on its way is not in here. */
export const vehicles: Vehicle[] = allVehicles.filter((v) => !v.hidden);
