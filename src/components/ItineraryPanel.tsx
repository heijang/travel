import { useEffect, useRef } from 'react'
import type { Day, Place } from '../types'
import {
  MODE_ICON, MODE_LABEL, PLACE_ICON, PLACE_LABEL,
  formatDate, formatDuration, itineraryFor, strongestNoteKind, NOTE_ICON,
} from '../lib/trip'
import NoteList from './NoteList'
import PlaceDetail from './PlaceDetail'

interface Props {
  days: Day[]
  selectedPlaceId: string | null
  onSelectPlace: (id: string | null) => void
  onHoverPlace: (id: string | null) => void
}

function ItemRow({
  place, carriedOver, index, selected, onSelect, onHover,
}: {
  place: Place
  carriedOver: boolean
  index: number
  selected: boolean
  onSelect: () => void
  onHover: (hovering: boolean) => void
}) {
  const ref = useRef<HTMLLIElement>(null)
  const noteKind = strongestNoteKind(place.notes)

  // Clicking a marker on the map scrolls the list to that row (FR-PLACE-6).
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selected])

  return (
    <li
      ref={ref}
      className={`item${selected ? ' item--selected' : ''}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <button type="button" className="item__head" onClick={onSelect}>
        <span className="item__order">{carriedOver ? '–' : index}</span>
        <span className="item__icon" aria-hidden="true">{PLACE_ICON[place.type]}</span>
        <span className="item__text">
          <span className="item__name">
            {place.name}
            {noteKind && (
              <span className={`item__note item__note--${noteKind}`} aria-label="Has a note">
                {NOTE_ICON[noteKind]}
              </span>
            )}
          </span>
          <span className="item__meta">
            {place.time ? `${place.time} · ` : ''}
            {PLACE_LABEL[place.type]}
            {carriedOver && ' · continuing stay'}
            {place.nights ? ` · ${place.nights} ${place.nights === 1 ? 'night' : 'nights'}` : ''}
            {place.durationMin ? ` · ${formatDuration(place.durationMin)}` : ''}
          </span>
        </span>
      </button>
      <div className="item__detail">
        <PlaceDetail place={place} hideHeader />
      </div>
    </li>
  )
}

function DaySection({
  day, selectedPlaceId, onSelectPlace, onHoverPlace,
}: {
  day: Day
  selectedPlaceId: string | null
  onSelectPlace: (id: string | null) => void
  onHoverPlace: (id: string | null) => void
}) {
  const items = itineraryFor(day)
  const route = day.route

  return (
    <section className="day" style={{ '--day-color': day.color } as React.CSSProperties}>
      <header className="day__head">
        <p className="day__label">
          <span className="day__badge">Day {day.dayNumber}</span>
          <span className="day__date">{formatDate(day.date)}</span>
        </p>
        <h2 className="day__title">{day.title}</h2>
        {day.summary && <p className="day__summary">{day.summary}</p>}
        {route && (route.distanceKm !== undefined || route.durationMin !== undefined) && (
          <p className="day__move">
            <span aria-hidden="true">{MODE_ICON[route.mode]}</span>
            <span className="sr-only">{MODE_LABEL[route.mode]} </span>
            {route.distanceKm !== undefined && `${route.distanceKm}km`}
            {route.durationMin !== undefined && ` · ${formatDuration(route.durationMin)}`}
          </p>
        )}
      </header>

      <NoteList notes={day.notes} collapsible />

      {route?.legs?.length ? (
        <ul className="legs">
          {route.legs.map((leg, i) => (
            <li key={`${leg.from}-${leg.to}-${i}`} className="leg">
              <span aria-hidden="true">{MODE_ICON[leg.mode]}</span>
              <span className="sr-only">{MODE_LABEL[leg.mode]} </span>
              {leg.note ?? `${leg.from} → ${leg.to}`}
            </li>
          ))}
        </ul>
      ) : null}

      <ol className="items">
        {items.map(({ place, carriedOver }, i) => (
          <ItemRow
            key={place.id + (carriedOver ? '-carried' : '')}
            place={place}
            carriedOver={carriedOver}
            index={i + 1}
            selected={selectedPlaceId === place.id}
            onSelect={() => onSelectPlace(selectedPlaceId === place.id ? null : place.id)}
            onHover={(h) => onHoverPlace(h ? place.id : null)}
          />
        ))}
      </ol>
    </section>
  )
}

export default function ItineraryPanel({
  days, selectedPlaceId, onSelectPlace, onHoverPlace,
}: Props) {
  return (
    <div className="panel__scroll">
      {days.map((day) => (
        <DaySection
          key={day.dayNumber}
          day={day}
          selectedPlaceId={selectedPlaceId}
          onSelectPlace={onSelectPlace}
          onHoverPlace={onHoverPlace}
        />
      ))}
    </div>
  )
}
