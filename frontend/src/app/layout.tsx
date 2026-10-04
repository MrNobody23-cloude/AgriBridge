import type { Metadata } from "next";
import "./globals.css";
import { LanguageProvider } from '@/components/LanguageProvider';

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
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#FAFAF7] text-[#1a1a1a]">
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
