'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// 登录后动态取数页面 + 底部导航用 usePathname，不做静态预渲染
export const dynamic = 'force-dynamic'

// 底导航 5 格图标——内联 SVG symbol path，照样稿 i-home/i-layers/i-cut/i-grid/i-user
const ICONS: Record<string, string> = {
  home: 'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z',
  film: 'M3 5h18v14H3z M7 5v14M17 5v14M3 10h4M3 14h4M17 10h4M17 14h4',
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
      {/* 状态栏遮罩：viewport-fit=cover 后页面延伸到 iOS 状态栏底下，滚动时正文会和
          时间/电量文字叠字（真机实拍反馈）。这条固定在最顶、高度=安全区，把穿过的内容挡住；
          首页跟深色头部同色系，其余页浅色磨砂；无刘海设备 env=0 高度为 0，等于不渲染 */}
      <div aria-hidden className={`fixed inset-x-0 top-0 z-30 h-[env(safe-area-inset-top)] ${
        path === '/' ? 'bg-[#1a1214]/85 backdrop-blur-sm' : 'bg-paper/85 backdrop-blur-sm'
      }`} />
      {/* 顶部留白 --stu-safe-top（globals.css）：普通浏览器 = 3rem（照样稿 .phead 52px 的意图），
          刘海屏/微信内打开（viewport-fit=cover 时 env 生效）= 1rem + 状态栏高度，防止状态栏压住内容。
          首页深色头部用同一变量做 -mt 抵消，再自己 pt 顶到屏幕最上沿——两处必须同源，别改成字面量 */}
      <main className="flex-1 px-5 pb-28 pt-[var(--stu-safe-top)]">{children}</main>

      {/* 底导航：5 格，中央「做片」凸起 */}
      {/* pb-4 与 globals.css 的 .safe-b（padding-bottom: env(safe-area-inset-bottom)）冲突：
          safe-b 后声明会整个覆盖 pb-4，安卓等无底部安全区设备上导航贴底无留白。
          改用同时含固定间距与安全区的合成值，不再叠加 safe-b。 */}
      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-lg items-end justify-around border-t border-line bg-white/95 shadow-[0_-6px_20px_-12px_rgba(20,20,20,0.25)] px-1.5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl">
        <Link href="/" className="w-[60px] text-center">
          <TabIcon d={ICONS.home} active={isActive('/')} />
          <span className={`mt-0.5 block text-[11px] ${isActive('/') ? 'font-bold text-flame' : 'text-ink3'}`}>首页</span>
        </Link>
        <Link href="/library" className="w-[60px] text-center">
          <TabIcon d={ICONS.film} active={isActive('/library')} />
          <span className={`mt-0.5 block text-[11px] ${isActive('/library') ? 'font-bold text-flame' : 'text-ink3'}`}>成片</span>
        </Link>
        {/* 做片：中央凸起钮，进框架选片流程。曾与「框架」tab 同指 /templates——两个入口一个页面、
            且本钮永远灰色，学员点了以为没反应（线上真实反馈）；现在框架库只归这个钮管，激活态也归它 */}
        <Link href="/templates" className="-mt-6 w-[60px] text-center">
          <span className="grad mx-auto flex h-[52px] w-[52px] items-center justify-center rounded-full text-white shadow-lift">
            <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={CUT_PATH} />
            </svg>
          </span>
          <span className={`mt-0.5 block text-[11px] ${isActive('/templates') ? 'font-bold text-flame' : 'text-ink3'}`}>做片</span>
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
