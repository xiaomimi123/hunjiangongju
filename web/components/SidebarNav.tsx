'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ICONS: Record<string, string> = {
  dashboard: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  film: 'M4 4h16v16H4zM4 9h16M4 15h16M9 4v16M15 4v16',
  doc: 'M6 3h9l4 4v14H6zM14 3v5h5',
  tag: 'M4 4h7l9 9-7 7-9-9zM8 8h.01',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 21a7 7 0 0 1 14 0M18 8a3 3 0 1 1 0 6M22 21a6 6 0 0 0-4-5.6',
  tasks: 'M4 6h16M4 12h16M4 18h10M2 6h.01M2 12h.01M2 18h.01',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H23a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 21a7 7 0 0 1 14 0',
}

const GROUPS: { label: string; items: { href: string; label: string; icon: string }[] }[] = [
  { label: '概览', items: [{ href: '/admin', label: '仪表盘', icon: 'dashboard' }] },
  { label: '内容', items: [
    { href: '/admin/materials', label: '素材', icon: 'film' },
    { href: '/admin/scripts', label: '文案', icon: 'doc' },
    { href: '/admin/tags', label: '标签', icon: 'tag' },
  ] },
  { label: '运营', items: [
    { href: '/admin/students', label: '学员数据', icon: 'users' },
    { href: '/admin/tasks', label: '任务', icon: 'tasks' },
  ] },
  { label: '系统', items: [
    { href: '/admin/models', label: '模型配置', icon: 'gear' },
    { href: '/admin/settings', label: '设置', icon: 'gear' },
    { href: '/admin/account', label: '账号', icon: 'user' },
  ] },
]

function Icon({ path }: { path: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d={path} />
    </svg>
  )
}

export default function SidebarNav() {
  const path = usePathname()
  return (
    <nav className="flex flex-col gap-5">
      {GROUPS.map((g) => (
        <div key={g.label} className="space-y-1">
          <p className="eyebrow px-3">{g.label}</p>
          {g.items.map((n) => {
            const active = n.href === '/admin' ? path === '/admin' : path.startsWith(n.href)
            return (
              <Link key={n.href} href={n.href}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  active ? 'grad text-white shadow-lift' : 'text-ink2 hover:bg-surface2'
                }`}>
                <Icon path={ICONS[n.icon]} />
                {n.label}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
