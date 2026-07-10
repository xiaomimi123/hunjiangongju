import './globals.css'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = { title: '投流素材混剪工具' }
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-dvh bg-gray-50 text-gray-900">{children}</body>
    </html>
  )
}
