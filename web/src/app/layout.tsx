import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/lib/theme";
import { LocaleProvider, LOCALE_INIT_SCRIPT } from "@/lib/i18n";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-jb",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FireWatch — МЧС РК",
  description: "Предиктивная аналитика пожарной безопасности — МЧС РК",
  // Установка на домашний экран: инспектор работает в поле, и приложение
  // должно запускаться без браузерной строки. iOS читает эти поля отдельно от
  // манифеста, поэтому они дублируются здесь.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "FireWatch",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  // Next выводит только современный mobile-web-app-capable, но iOS до сих пор
  // читает apple-префикс: без него приложение с домашнего экрана открывается
  // в браузерной строке, а не полноэкранно.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  // Экран в перчатках: масштабирование не запрещаем (это ломает доступность),
  // но стартуем в 1:1, чтобы боевые экраны не открывались уменьшенными.
  initialScale: 1,
  width: "device-width",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ru"
      className={`dark ${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* No-FOUC: set the theme class and <html lang> before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: LOCALE_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <LocaleProvider>
            <AuthProvider>{children}</AuthProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
