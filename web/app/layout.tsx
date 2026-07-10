import './globals.css'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = { title: '东方文澜', icons: { icon: '/brand/logo-mark.png' } }
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#f2f3f5',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
