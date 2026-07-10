'use client'

export default function BottomSheet({
  open, onClose, title, children,
}: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[70vh] overflow-auto rounded-t-3xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-lift">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line" />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-base font-bold tracking-tight">{title}</h3>
          <button onClick={onClose} className="rounded-full px-2 py-1 text-sm text-ink3">关闭</button>
        </div>
        {children}
      </div>
    </div>
  )
}
