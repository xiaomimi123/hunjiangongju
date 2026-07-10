import { STATUS_LABELS, statusTone, PIPELINE, stageIndex } from '@/lib/status'

// 状态胶囊
export function StatusPill({ status }: { status: string }) {
  const tone = statusTone(status)
  return <span className={`pill pill-${tone}`}>{STATUS_LABELS[status] ?? status}</span>
}

// signature：生产线状态轨。done=火焰实心，current=火焰描边+脉冲，failed=红，pending=灰
export function PipelineRail({ status }: { status: string }) {
  const cur = stageIndex(status)
  const failed = status === 'FAILED'
  const done = status === 'EXPORTED'
  const attention = ['MATERIAL_PENDING', 'PREVIEW_PENDING', 'QC_FAILED'].includes(status)

  return (
    <div className="rail">
      {PIPELINE.map((label, i) => {
        const isDone = i < cur || done
        const isCur = i === cur && !done
        return (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`rail-node ${
                  isDone
                    ? 'grad text-white'
                    : isCur && failed
                    ? 'bg-bad text-white'
                    : isCur && attention
                    ? 'border-2 border-warn text-warn'
                    : isCur
                    ? 'border-2 border-flame text-flame'
                    : 'border border-line bg-surface2 text-ink3'
                }`}
              >
                {isDone ? '✓' : i + 1}
              </div>
              <span className={`text-[11px] ${isCur ? 'font-medium text-ink' : isDone ? 'text-ink2' : 'text-ink3'}`}>
                {label}
              </span>
            </div>
            {i < PIPELINE.length - 1 && (
              <div className={`rail-line -mt-5 ${isDone ? 'grad' : 'bg-line'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
