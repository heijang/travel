import type { TourStop } from '../lib/tour'
import { PLACE_ICON, PLACE_LABEL, formatDate, formatDuration, sortNotes } from '../lib/trip'
import { NOTE_ICON } from '../lib/trip'
import { trip } from '../lib/trip'

/** Max notes on a card. The tour is a skim, so it doesn't show them all. */
const MAX_NOTES = 2

interface Props {
  stop: TourStop
  index: number
  total: number
  /** True while stopped; false in transit, when the card shows the previous stop. */
  arrived: boolean
}

export default function TourCard({ stop, index, total, arrived }: Props) {
  const { place } = stop
  const day = trip.days.find((d) => d.dayNumber === stop.dayNumber)
  const notes = place.notes ? sortNotes(place.notes).slice(0, MAX_NOTES) : []

  return (
    <article
      className={`tourcard${arrived ? ' tourcard--arrived' : ''}`}
      style={{ '--day-color': stop.color } as React.CSSProperties}
      aria-live="polite"
    >
      {place.imageUrl && (
        <figure className="tourcard__figure">
          <img
            className="tourcard__photo"
            src={place.imageUrl}
            alt=""
            loading="lazy"
            onError={(e) => { e.currentTarget.closest('figure')?.remove() }}
          />
          {place.imageCredit && (
            <figcaption className="photocredit">{place.imageCredit}</figcaption>
          )}
        </figure>
      )}

      <header className="tourcard__head">
        <span className="tourcard__day">Day {stop.dayNumber}</span>
        {day && <span className="tourcard__date">{formatDate(day.date)}</span>}
        <span className="tourcard__count">{index + 1} / {total}</span>
      </header>

      <h2 className="tourcard__name">
        <span className="tourcard__icon" aria-hidden="true">{PLACE_ICON[place.type]}</span>
        {place.name}
      </h2>
      {place.nameLocal && <p className="tourcard__local">{place.nameLocal}</p>}

      <p className="tourcard__meta">
        {place.time ? `${place.time} · ` : ''}
        {PLACE_LABEL[place.type]}
        {place.nights ? ` · ${place.nights} ${place.nights === 1 ? 'night' : 'nights'}` : ''}
        {place.durationMin ? ` · ${formatDuration(place.durationMin)}` : ''}
        {place.priceNote ? ` · ${place.priceNote}` : ''}
      </p>

      {place.description && <p className="tourcard__desc">{place.description}</p>}

      {notes.length > 0 && (
        <ul className="tourcard__notes">
          {notes.map((note, i) => (
            <li key={i} className={`tourcard__note tourcard__note--${note.kind}`}>
              <span aria-hidden="true">{NOTE_ICON[note.kind]}</span>
              <span className="tourcard__notetext">{note.text}</span>
            </li>
          ))}
        </ul>
      )}

      {place.links.length > 0 && (
        <ul className="tourcard__links">
          {place.links.map((link) => (
            <li key={link.url + link.label}>
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {link.label}
                <span aria-hidden="true"> ↗</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
