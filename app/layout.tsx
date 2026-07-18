import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  return {
    title: "xDroneFit",
    description: "Van kaart en DJI-foto naar een nauwkeurige Blender-camera.",
    openGraph: { title: "xDroneFit", description: "Van dronefoto naar overtuigende Blender-render", images: [{ url: image, width: 1680, height: 941 }] },
    twitter: { card: "summary_large_image", title: "xDroneFit", description: "Van dronefoto naar overtuigende Blender-render", images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="nl"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
