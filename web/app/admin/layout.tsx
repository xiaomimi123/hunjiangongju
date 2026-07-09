import Link from 'next/link'

const NAV = [
  { href: '/admin/tags', label: '标签' },
  { href: '/admin/materials', label: '素材' },
  { href: '/admin/scripts', label: '文案' },
  { href: '/admin/tasks', label: '任务' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
      <header className="sticky top-0 z-10 border-b bg-white px-4 py-3 text-base font-semibold">
        运营后台
      </header>
      <main className="flex-1 p-4 pb-20">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-3xl border-t bg-white pb-[env(safe-area-inset-bottom)]">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="flex-1 py-3 text-center text-sm text-gray-700 active:bg-gray-100">
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
