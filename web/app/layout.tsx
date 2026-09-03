import './globals.css'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = { title: '东方文澜', icons: { icon: '/brand/logo-mark.png' } }
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // cover：让 env(safe-area-inset-top) 在刘海屏上生效（学员端顶部留白 --stu-safe-top 依赖它）；
  // 深色头部会自然涂满状态栏底下，比留白条好看
  viewportFit: 'cover',
  themeColor: '#f2f3f5',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
