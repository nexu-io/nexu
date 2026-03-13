import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Session Chat",
  description:
    "Minimal session chat sidecar for Nexu Desktop cold-start validation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
