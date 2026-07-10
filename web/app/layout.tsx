import './globals.css'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = { title: '投流工作台 · 混剪' }
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
