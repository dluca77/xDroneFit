import type { Metadata } from "next";
import ProjectPortal from "./ProjectPortal";
export const metadata: Metadata={title:"xDroneFit | Vastgoed in dronefoto's",description:"Georeferentie en camera-matching voor vastgoedvisualisaties in Blender."};
export default function Home(){return <ProjectPortal/>}