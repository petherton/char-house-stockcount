import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Char House Stock Count",
  description: "Scan-based stock count tool for The Char House venues",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
