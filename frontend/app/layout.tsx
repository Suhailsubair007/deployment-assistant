import type { Metadata } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { ThemeProvider } from "next-themes";

import "./globals.css";

// Next.js downloads both fonts when the page is built and serves them with the page,
// so the browser never asks Google for them. globals.css reads the two variables.
const textFont = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta" });
// For image names and tables: every character has the same width, so numbers line up.
const codeFont = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "Deployment Assistant",
  description: "Deploy, roll back and check health by chat",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme is set on <html> before React starts, so React must not report that difference.
    <html lang="en" suppressHydrationWarning className={`${textFont.variable} ${codeFont.variable}`}>
      <body className="flex h-dvh flex-col text-sm antialiased">
        {/* Remembers the light or dark choice; without one the system setting decides. */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
