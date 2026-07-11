'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Item = { href: string; label: string; icon: keyof typeof ICONS }

const ICONS = {
  home: 'M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  film: 'M4 5h16v14H4zM4 9h16M4 15h16M9 5v14M15 5v14',
  tag: 'M4 4h7l9 9-7 7-9-9zM8 8h.01',
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5',
  doc: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  layers: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 16.5 12 21l9-4.5',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 21a7 7 0 0 1 14 0',
} as const

function Glyph({ d, active }: { d: string; active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke={active ? 'url(#flame)' : 'currentColor'} strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round">
      <defs>
        <linearGradient id="flame" x1="0" y1="0" x2="24" y2="24">
          <stop offset="0" stopColor="#ff3b30" />
          <stop offset="1" stopColor="#d0021b" />
        </linearGradient>
      </defs>
      <path d={d} />
    </svg>
  )
}

export default function BottomNav({ items, maxW = 'max-w-lg' }: { items: Item[]; maxW?: string }) {
  const path = usePathname()
  return (
    <nav className={`fixed inset-x-0 bottom-0 z-20 mx-auto ${maxW} border-t border-line bg-surface/85 backdrop-blur-lg safe-b`}>
      <div className="flex">
        {items.map((it) => {
          const active = it.href === '/' ? path === '/' : path.startsWith(it.href)
          return (
            <Link key={it.href} href={it.href}
              className="flex flex-1 flex-col items-center gap-1 py-2.5"
              aria-current={active ? 'page' : undefined}>
              <Glyph d={ICONS[it.icon]} active={active} />
              <span className={`text-[11px] ${active ? 'grad-text font-medium' : 'text-ink3'}`}>{it.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
