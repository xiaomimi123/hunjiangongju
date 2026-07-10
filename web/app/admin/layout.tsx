import SidebarNav from '@/components/SidebarNav'
import SignOut from '@/components/SignOut'

export const dynamic = 'force-dynamic'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col justify-between border-r border-line bg-surface p-4 md:flex">
        <div className="space-y-6">
          <div className="flex items-center gap-2 px-2">
            <span className="grad h-6 w-6 rounded-md shadow-lift" />
            <span className="font-display text-base font-bold">运营控制台</span>
          </div>
          <SidebarNav />
        </div>
        <div className="flex items-center justify-between px-2">
          <span className="chip"><span className="chip-dot bg-warn" />运营</span>
          <SignOut />
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-5 py-6 md:px-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  )
}
