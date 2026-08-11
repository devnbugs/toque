import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Toque Control Room",
  description: "Operate authenticated Nusuk services from one dashboard.",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
