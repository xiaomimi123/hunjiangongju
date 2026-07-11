import BottomNav from '@/components/BottomNav'

// 登录后动态取数页面 + 底部导航用 usePathname，不做静态预渲染
export const dynamic = 'force-dynamic'

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 px-5 py-3.5 backdrop-blur-lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-mark.png" alt="东方文澜" className="h-7 w-auto" />
        <span className="font-display text-[15px] font-bold tracking-tight">东方文澜</span>
      </header>
      <main className="flex-1 px-5 pb-28 pt-1">{children}</main>
      <BottomNav
        items={[
          { href: '/', label: '首页', icon: 'home' },
          { href: '/templates', label: '模版', icon: 'grid' },
          { href: '/works', label: '作品', icon: 'film' },
          { href: '/me', label: '我的', icon: 'user' },
        ]}
      />
    </div>
  )
}
