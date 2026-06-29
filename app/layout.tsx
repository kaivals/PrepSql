import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { QueryProvider } from '@/components/QueryProvider'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'PrepSQL',
  description: 'Natural language to SQL — grounded in your schema',
  icons: {
    icon: '/icon.svg',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#F9FAFB',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="font-sans antialiased relative min-h-screen">
        <QueryProvider>
          {/* Aurora blobs background */}
          <div className="fixed inset-0 -z-10 overflow-hidden bg-[#F9FAFB] pointer-events-none">
            <div className="absolute -top-[10%] -left-[10%] w-[50%] h-[50%] rounded-full bg-[#93C5FD]/35 blur-[120px]" />
            <div className="absolute -bottom-[10%] -right-[10%] w-[60%] h-[60%] rounded-full bg-[#A5F3FC]/28 blur-[130px]" />
            <div className="absolute top-[30%] left-[20%] w-[40%] h-[40%] rounded-full bg-[#C4B5F4]/22 blur-[100px]" />
            <div className="absolute top-[10%] right-[20%] w-[35%] h-[35%] rounded-full bg-[#BFDBFE]/30 blur-[110px]" />
          </div>
          {children}
          {process.env.NODE_ENV === 'production' && <Analytics />}
        </QueryProvider>
      </body>
    </html>
  )
}
