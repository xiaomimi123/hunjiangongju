'use client'
export default function Modal({ open, onClose, title, wide, children }: {
  open: boolean; onClose: () => void; title: string; wide?: boolean; children: React.ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink/50 p-4" onClick={onClose}>
      <div className={`card mx-auto my-[5vh] w-full ${wide ? 'max-w-2xl' : 'max-w-md'} p-6`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-ink3 transition hover:bg-surface2 hover:text-ink" aria-label="关闭">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
