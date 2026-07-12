export default function StatCard({ label, value, hint, accent }: {
  label: string; value: React.ReactNode; hint?: string; accent?: boolean
}) {
  return (
    <div className="card relative overflow-hidden p-5">
      {accent && <span className="absolute inset-x-0 top-0 h-1 grad" />}
      <p className="text-sm text-ink3">{label}</p>
      <p className="num mt-1.5 text-[2rem] font-bold leading-none tracking-tight">{value}</p>
      {hint && <p className="mt-1.5 text-xs text-ink3">{hint}</p>}
    </div>
  )
}
