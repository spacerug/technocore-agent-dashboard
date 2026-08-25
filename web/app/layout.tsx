import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://technocore-memory-passport.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Neon Memory Passport",
  description:
    "A local-first browser dashboard for Technocore signed messages, portable encrypted agent memory, and verifiable digital artifacts.",
  openGraph: {
    title: "Neon Memory Passport",
    description:
      "Give an AI agent portable, encrypted, DID-signed memory without uploading its private key.",
    type: "website",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Neon Memory Passport",
    description: "Portable encrypted memory and signed Technocore tools for AI agents.",
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
