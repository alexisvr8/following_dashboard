import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppHeader } from "@/components/layout/AppHeader";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import "./globals.css";

// design/design.md: Geist para la UI, JetBrains Mono para labels, cifras, fechas y horarios.
const geist = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Xtract - Dashboard",
  description: "Dashboard personal de seguimiento de cuentas — Metodología Xtract",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${geist.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider>
            <div className="flex min-h-full flex-1 flex-col">
              <AppHeader />
              <main className="min-w-0 flex-1">{children}</main>
            </div>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
