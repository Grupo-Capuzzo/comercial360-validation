import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Comercial 360 | Grupo Capuzzo",
  description: "CRM e visão comercial consolidada do Grupo Capuzzo.",
  icons: {
    icon: "/brand-mark.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}


