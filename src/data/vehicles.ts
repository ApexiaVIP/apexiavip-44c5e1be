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
}

export const vehicles: Vehicle[] = [
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
