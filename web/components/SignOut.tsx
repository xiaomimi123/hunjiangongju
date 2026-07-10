'use client'
import { useRouter } from 'next/navigation'

export default function SignOut() {
  const router = useRouter()
  async function out() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
  }
  return (
    <button onClick={out} className="text-xs text-ink3 active:text-ink" aria-label="退出登录">
      退出
    </button>
  )
}
