import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="grad grid h-14 w-14 place-items-center rounded-2xl text-2xl shadow-lift">🔍</span>
      <h1 className="font-display text-2xl font-bold">页面走丢了</h1>
      <p className="text-sm text-ink2">这里什么都没有，回工作台继续做爆款吧。</p>
      <Link href="/" className="btn-primary px-6">回首页</Link>
    </div>
  )
}
