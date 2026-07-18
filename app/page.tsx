import type { Metadata } from "next";
import DroneFitApp from "./DroneFitApp";

export const metadata: Metadata = {
  title: "DroneFit | Vastgoed in dronefoto's",
  description: "Georeferentie en camera-matching voor vastgoedvisualisaties in Blender.",
};

export default function Home() {
  return <DroneFitApp />;
}
