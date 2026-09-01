import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import { getAppUrl } from "@/lib/env";
import "./globals.css";

const plex = IBM_Plex_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const siteDescription =
  "Cinematography breakdown from a YouTube or TikTok link, or an uploaded still: lens, lighting, movement, and how to recreate the shot.";

export const metadata: Metadata = {
  metadataBase: new URL(getAppUrl()),
  title: {
    default: "ShotBreakdown",
    template: "%s | ShotBreakdown",
  },
  description: siteDescription,
  openGraph: {
    siteName: "ShotBreakdown",
    type: "website",
    title: "ShotBreakdown",
    description: siteDescription,
  },
  twitter: {
    card: "summary_large_image",
    title: "ShotBreakdown",
    description: siteDescription,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${plex.variable} h-full antialiased`}>
      <body className={`${plex.className} min-h-full flex flex-col bg-black text-white`}>{children}</body>
    </html>
  );
}
