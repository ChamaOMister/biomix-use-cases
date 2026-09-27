import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Biomix | ERP Sales Workbench",
  description: "A portfolio project for trustworthy invoiced-sales reporting.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
