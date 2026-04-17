import type { Metadata } from "next";
import type React from "react";

import { I18nProvider } from "@/lib/i18n";

import "./globals.css";

// Inline the official Agora "a" mark as an SVG favicon.
const AGORA_FAVICON_DATA_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" fill="none"><path d="M8.715 13.81a4.81 4.81 0 1 1 0-9.62 4.81 4.81 0 0 1 0 9.62Zm5.602-11.818-.074.098-.073.097-.097-.073-.093-.073a8.722 8.722 0 1 0-5.265 15.68 8.63 8.63 0 0 0 5.265-1.772l.093-.068.097-.078.073.102.074.098a4.16 4.16 0 0 0 2.798 1.68l.322.044V.273l-.322.044a4.165 4.165 0 0 0-2.798 1.675Z" fill="#00C2FF"/></svg>`
  );

export const metadata: Metadata = {
  title: "Agora Conversational AI Demo",
  description:
    "Demo app with server-side join flow, avatar support, and live transcriptions.",
  icons: {
    icon: AGORA_FAVICON_DATA_URL
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Browser extensions (password managers, dark-mode helpers, etc.) often
    // inject attributes onto <html> / <body> before React hydrates, which
    // produces a hydration warning. suppressHydrationWarning tells React to
    // ignore attribute mismatches on these specific elements only.
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
