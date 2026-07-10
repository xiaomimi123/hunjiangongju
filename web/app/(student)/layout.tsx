import BottomNav from '@/components/BottomNav'
import SignOut from '@/components/SignOut'

// 登录后动态取数页面 + 底部导航用 usePathname，不做静态预渲染
export const dynamic = 'force-dynamic'

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 backdrop-blur-lg">
        <div className="flex items-center gap-2">
          <span className="grad h-5 w-5 rounded-md shadow-lift" />
          <span className="font-display text-[15px] font-bold tracking-tight">投流工作台</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="chip"><span className="chip-dot grad" />学员</span>
          <SignOut />
        </div>
      </header>
      <main className="flex-1 px-5 pb-28 pt-1">{children}</main>
      <BottomNav
        items={[
          { href: '/', label: '首页', icon: 'home' },
          { href: '/works', label: '我的作品', icon: 'film' },
        ]}
      />
    </div>
  )
}
