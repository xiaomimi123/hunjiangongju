'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// 登录后动态取数页面 + 底部导航用 usePathname，不做静态预渲染
export const dynamic = 'force-dynamic'

// 底导航 5 格图标——内联 SVG symbol path，照样稿 i-home/i-layers/i-cut/i-grid/i-user
const ICONS: Record<string, string> = {
  home: 'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z',
  layers: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5 M3 17l9 5 9-5',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  user: 'M12 8m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0 M4 21c1.5-4 5-6 8-6s6.5 2 8 6',
}
// 中央凸起钮图标——照样稿 i-cut（剪刀）
const CUT_PATH = 'M6 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M6 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M8.5 7.5L20 19M8.5 16.5L20 5'

function TabIcon({ d, active }: { d: string; active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`mx-auto h-5 w-5 ${active ? 'text-flame' : 'text-ink3'}`}
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const isActive = (href: string) => (href === '/' ? path === '/' : path.startsWith(href))

  return (
    <div className="relative mx-auto flex min-h-dvh max-w-lg flex-col bg-paper">
      <main className="flex-1 px-5 pb-28 pt-3">{children}</main>

      {/* 底导航：5 格，中央「做片」凸起 */}
      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-lg items-end justify-around border-t border-line bg-white/94 px-1.5 pb-4 pt-2 backdrop-blur-lg safe-b">
        <Link href="/" className="w-[60px] text-center">
          <TabIcon d={ICONS.home} active={isActive('/')} />
          <span className={`mt-0.5 block text-[11px] ${isActive('/') ? 'font-bold text-flame' : 'text-ink3'}`}>首页</span>
        </Link>
        <Link href="/templates" className="w-[60px] text-center">
          <TabIcon d={ICONS.layers} active={isActive('/templates')} />
          <span className={`mt-0.5 block text-[11px] ${isActive('/templates') ? 'font-bold text-flame' : 'text-ink3'}`}>框架</span>
        </Link>
        <Link href="/templates" className="-mt-6 w-[60px] text-center">
          <span className="grad mx-auto flex h-[52px] w-[52px] items-center justify-center rounded-full text-white shadow-lift">
            <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={CUT_PATH} />
            </svg>
          </span>
          <span className="mt-0.5 block text-[11px] text-ink3">做片</span>
        </Link>
        <Link href="/tools" className="w-[60px] text-center">
          <TabIcon d={ICONS.grid} active={isActive('/tools')} />
          <span className={`mt-0.5 block text-[11px] ${isActive('/tools') ? 'font-bold text-flame' : 'text-ink3'}`}>工具</span>
        </Link>
        <Link href="/me" className="w-[60px] text-center">
          <TabIcon d={ICONS.user} active={isActive('/me')} />
          <span className={`mt-0.5 block text-[11px] ${isActive('/me') ? 'font-bold text-flame' : 'text-ink3'}`}>我的</span>
        </Link>
      </nav>
    </div>
  )
}
