import SidebarNav from '@/components/SidebarNav'
import SignOut from '@/components/SignOut'

export const dynamic = 'force-dynamic'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-paper">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col justify-between border-r border-line bg-surface px-3 py-4 md:flex">
        <div className="space-y-6 overflow-y-auto">
          <div className="flex items-center gap-2 px-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-mark.png" alt="东方文澜" className="h-8 w-auto" />
            <span className="font-display text-base font-bold">东方文澜</span>
          </div>
          <SidebarNav />
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-line px-2 pt-3">
          <span className="chip"><span className="chip-dot bg-warn" />运营</span>
          <SignOut />
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-5 py-7 md:px-9">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  )
}
