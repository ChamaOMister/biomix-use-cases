import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sales dashboard | Biomix",
  description: "A portfolio project for trustworthy invoiced-sales reporting.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
