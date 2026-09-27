import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "AgriBridge AI — India's Agricultural Trust Intelligence Platform",
  description: "Protecting 50M+ Indian farmers from supply chain fraud using Polygon Blockchain and Agentic AI — from Nashik to New York.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className={`${inter.className} min-h-full flex flex-col bg-[#FAFAF7] text-[#1a1a1a]`}>
        {children}
      </body>
    </html>
  );
}
