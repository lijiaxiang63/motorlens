// 5×3 live joint table (flexion + ROM per joint), shared by the untimed
// Joint Monitor and the timed ROM test's record screen. Cells are clickable
// (chart selection) only when onSelect is provided.

import { FINGER_JOINTS } from '../../metrics/rom'
import type { Finger, JointId, JointSummaries } from '../../types'
import { cn } from '../lib/cn'
import { fmt } from '../format'

const FINGERS = Object.keys(FINGER_JOINTS) as Finger[]
const COLUMN_TITLES = ['MCP / CMC', 'PIP / MCP', 'DIP / IP']

export function JointTable({
  summaries,
  selected,
  onSelect,
  className,
}: {
  summaries: JointSummaries
  selected?: JointId
  onSelect?: (id: JointId) => void
  className?: string
}) {
  return (
    <table
      className={cn(
        'w-full overflow-hidden rounded-xl border bg-surface [border-collapse:separate] [border-spacing:0]',
        className,
      )}
    >
      <thead>
        <tr>
          <th className="border-b border-r bg-surface-2 px-2.5 py-2 text-xs uppercase tracking-[0.6px] text-muted-foreground">
            Finger
          </th>
          {COLUMN_TITLES.map((c) => (
            <th
              key={c}
              className="border-b bg-surface-2 px-2.5 py-2 text-xs uppercase tracking-[0.6px] text-muted-foreground [&:not(:last-child)]:border-r"
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {FINGERS.map((finger, fi) => (
          <tr key={finger}>
            <td
              className={cn(
                'border-r bg-surface-2 px-2.5 py-2 text-center font-semibold capitalize',
                fi < FINGERS.length - 1 && 'border-b',
              )}
            >
              {finger}
            </td>
            {FINGER_JOINTS[finger].map((id) => {
              const js = summaries[id]
              return (
                <td
                  key={id}
                  tabIndex={onSelect ? 0 : undefined}
                  onClick={onSelect ? () => onSelect(id) : undefined}
                  className={cn(
                    'px-2.5 py-2 text-center [&:not(:last-child)]:border-r',
                    onSelect && 'cursor-pointer hover:bg-surface-2',
                    fi < FINGERS.length - 1 && 'border-b',
                    selected === id && 'outline outline-2 -outline-offset-2 outline-accent',
                  )}
                >
                  <div className="text-lg font-semibold tabular-nums">
                    {fmt(js.currentDeg, 0, '°')}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    ROM {fmt(js.romDeg, 0, '°')}
                  </div>
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
