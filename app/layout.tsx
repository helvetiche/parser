import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import AppProviders from "@/components/providers/AppProviders";
import Background from "@/components/ui/Background";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Parser",
  description: "Parser application",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="min-h-screen font-sans">
        <Background />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
