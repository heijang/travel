import type { Place } from '../types'
import { PLACE_ICON, PLACE_LABEL, formatDate, formatDuration } from '../lib/trip'
import NoteList from './NoteList'

export default function PlaceDetail({ place }: { place: Place }) {
  const duration = formatDuration(place.durationMin)
  return (
    <article className="detail">
      <header className="detail__head">
        <span className="detail__icon" aria-hidden="true">{PLACE_ICON[place.type]}</span>
        <div>
          <h3 className="detail__name">{place.name}</h3>
          {place.nameLocal && <p className="detail__local">{place.nameLocal}</p>}
        </div>
      </header>

      <p className="detail__type">{PLACE_LABEL[place.type]}</p>

      {place.imageUrl && (
        <figure className="detail__figure">
          <img
            className="detail__image"
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

      {place.description && <p className="detail__desc">{place.description}</p>}

      <dl className="detail__facts">
        {place.address && (
          <div><dt>Address</dt><dd>{place.address}</dd></div>
        )}
        {place.time && (
          <div><dt>Time</dt><dd>{place.time}</dd></div>
        )}
        {duration && (
          <div><dt>Duration</dt><dd>{duration}</dd></div>
        )}
        {place.nights && place.checkIn && place.checkOut && (
          <div>
            <dt>Stay</dt>
            <dd>
              {place.nights} {place.nights === 1 ? 'night' : 'nights'} ·{' '}
              {formatDate(place.checkIn)} → {formatDate(place.checkOut)}
            </dd>
          </div>
        )}
        {place.priceNote && (
          <div><dt>Cost</dt><dd>{place.priceNote}</dd></div>
        )}
      </dl>

      {place.tags?.length ? (
        <ul className="tags">
          {place.tags.map((t) => <li key={t} className="tag">{t}</li>)}
        </ul>
      ) : null}

      {/* Notes sit above the links — warnings should be read before anything is clicked. */}
      <NoteList notes={place.notes} />

      {place.links.length > 0 && (
        <ul className="links">
          {place.links.map((link) => (
            <li key={link.url + link.label}>
              <a
                className="link"
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {link.label}
                <span className="link__ext" aria-hidden="true">↗</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
