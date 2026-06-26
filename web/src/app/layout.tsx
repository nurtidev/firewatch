import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FireWatch",
  description: "Предиктивная аналитика пожарной безопасности — ДЧС РК",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
