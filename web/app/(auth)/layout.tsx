// 登录页为客户端交互页，不做静态预渲染
export const dynamic = 'force-dynamic'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
