import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://neoncore.space";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "NEONCORE | Sovereign Agent Console",
  description:
    "A local-first control center for Technocore agent identity, signed messages, artifact provenance, encrypted memory, and security.",
  openGraph: {
    title: "NEONCORE | Sovereign Agent Console",
    description:
      "The sovereign operating system for digital agents: identity, communication, provenance, memory, and security.",
    type: "website",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "NEONCORE | Sovereign Agent Console",
    description: "Identity, signed communication, provenance, encrypted memory, and security for digital agents.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
