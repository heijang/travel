import { trip } from '../lib/trip'
import type { Day } from '../types'

/** Whether this day carries a warning note anywhere (FR-NOTE-9). */
function hasWarning(day: Day): boolean {
  if (day.notes?.some((n) => n.kind === 'warning')) return true
  return day.places.some((p) => p.notes?.some((n) => n.kind === 'warning'))
}

interface Props {
  selectedDay: number | null
  onSelect: (day: number | null) => void
}

export default function DayTabs({ selectedDay, onSelect }: Props) {
  return (
    <nav className="daytabs" aria-label="Select day">
      <button
        type="button"
        className={`daytab${selectedDay === null ? ' daytab--active' : ''}`}
        aria-pressed={selectedDay === null}
        onClick={() => onSelect(null)}
      >
        All
      </button>
      {trip.days.map((day) => {
        const active = selectedDay === day.dayNumber
        return (
          <button
            key={day.dayNumber}
            type="button"
            className={`daytab${active ? ' daytab--active' : ''}`}
            aria-pressed={active}
            style={{ '--day-color': day.color } as React.CSSProperties}
            onClick={() => onSelect(day.dayNumber)}
            title={day.title}
          >
            <span className="daytab__dot" aria-hidden="true" />
            Day {day.dayNumber}
            {hasWarning(day) && (
              <span className="daytab__warn" title="Has a warning" aria-label="Has a warning">⚠</span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
