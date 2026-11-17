import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Free Coverage Finder',
  description:
    'Paste a New York Times link to find the same story on news sites that are free to read.',
  robots: { index: false, follow: false },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
