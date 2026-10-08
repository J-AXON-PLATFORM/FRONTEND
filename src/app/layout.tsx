import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "J-AXON",
  description: "Fundacion tecnica del frontend de J-AXON.",
  robots: {
    follow: false,
    index: false,
    nocache: true,
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
