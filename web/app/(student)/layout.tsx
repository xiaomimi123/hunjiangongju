import Link from 'next/link'

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <main className="flex-1 p-4 pb-20">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-lg border-t bg-white pb-[env(safe-area-inset-bottom)]">
        <Link href="/" className="flex-1 py-3 text-center text-sm">首页</Link>
        <Link href="/works" className="flex-1 py-3 text-center text-sm">我的作品</Link>
      </nav>
    </div>
  )
}
