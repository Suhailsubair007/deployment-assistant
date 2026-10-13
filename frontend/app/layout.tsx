import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";

import "./globals.css";

export const metadata: Metadata = {
  title: "Deployment Assistant",
  description: "Deploy, roll back and check health by chat",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme is set on <html> before React starts, so React must not report that difference.
    <html lang="en" suppressHydrationWarning>
      <body className="flex h-dvh flex-col text-sm antialiased">
        {/* Remembers the light or dark choice; without one the system setting decides. */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
