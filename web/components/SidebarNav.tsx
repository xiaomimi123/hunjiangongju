'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/admin/students', label: '学员数据' },
  { href: '/admin/tags', label: '标签' },
  { href: '/admin/materials', label: '素材' },
  { href: '/admin/scripts', label: '文案' },
  { href: '/admin/tasks', label: '任务' },
  { href: '/admin/settings', label: '设置' },
]

export default function SidebarNav() {
  const path = usePathname()
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((n) => {
        const active = path.startsWith(n.href)
        return (
          <Link key={n.href} href={n.href}
            className={`rounded-xl px-4 py-2.5 text-sm font-medium transition ${active ? 'grad text-white shadow-lift' : 'text-ink2 hover:bg-surface2'}`}>
            {n.label}
          </Link>
        )
      })}
    </nav>
  )
}
