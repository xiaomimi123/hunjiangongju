'use client'

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#f2f3f5', color: '#141414' }}>
        <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, display: 'grid', placeItems: 'center', borderRadius: 16, fontSize: 24, background: 'linear-gradient(100deg,#ff3b30,#d0021b)' }}>⚠️</div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>出了点问题</h1>
          <p style={{ fontSize: 14, color: '#5b6169' }}>刷新重试，或稍后再来。</p>
          <button onClick={() => reset()}
            style={{ minHeight: 48, padding: '0 24px', borderRadius: 16, color: '#fff', border: 'none', background: 'linear-gradient(100deg,#ff3b30,#d0021b)' }}>
            重试
          </button>
        </div>
      </body>
    </html>
  )
}
