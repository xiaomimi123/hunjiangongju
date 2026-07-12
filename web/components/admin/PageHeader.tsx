export default function PageHeader({ title, subtitle, children }: {
  title: string; subtitle?: string; children?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-[1.6rem] font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink3">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}
