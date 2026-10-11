import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppProviders } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "J-AXON",
  description: "Acceso seguro a J-AXON.",
  robots: {
    follow: false,
    index: false,
    nocache: true,
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body><AppProviders>{children}</AppProviders></body>
    </html>
  );
}
