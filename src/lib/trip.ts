import type {
  Day, ItineraryItem, LngLat, Note, NoteKind, Place, PlaceType,
  TransportMode, Trip,
} from '../types'
import raw from '../data/norway-fjords.json'

/** Underscore-prefixed keys such as `_meta` are ignored by the loader (FR-DATA-4). */
export const trip = raw as unknown as Trip

/** Severity order. A marker badge shows only the strongest of these (FR-NOTE-4). */
const NOTE_RANK: Record<NoteKind, number> = { warning: 3, tip: 2, note: 1 }

export function strongestNoteKind(notes?: Note[]): NoteKind | null {
  if (!notes?.length) return null
  return notes.reduce<NoteKind>(
    (best, n) => (NOTE_RANK[n.kind] > NOTE_RANK[best] ? n.kind : best),
    notes[0].kind,
  )
}

export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => NOTE_RANK[b.kind] - NOTE_RANK[a.kind])
}

export const NOTE_ICON: Record<NoteKind, string> = {
  warning: '⚠', tip: '💡', note: '📝',
}

export const NOTE_LABEL: Record<NoteKind, string> = {
  warning: 'Warning', tip: 'Tip', note: 'Note',
}

export const PLACE_ICON: Record<PlaceType, string> = {
  stay: '🛏', sight: '📍', hike: '🥾', food: '🍽', transport: '🚉', activity: '🎫',
}

export const PLACE_LABEL: Record<PlaceType, string> = {
  stay: 'Stay', sight: 'Sight', hike: 'Hike', food: 'Food',
  transport: 'Transit', activity: 'Activity',
}

export const MODE_ICON: Record<TransportMode, string> = {
  car: '🚗', ferry: '⛴', train: '🚆', bus: '🚌', walk: '🚶', hike: '🥾', flight: '✈',
}

export const MODE_LABEL: Record<TransportMode, string> = {
  car: 'Drive', ferry: 'Ferry', train: 'Train', bus: 'Bus',
  walk: 'Walk', hike: 'Hike', flight: 'Flight',
}

/** Line style per transport mode. No dash means a solid line (FR-MAP-4). */
export const MODE_LINE: Record<TransportMode, { width: number; dash?: number[] }> = {
  car: { width: 4 },
  ferry: { width: 3, dash: [2, 2] },
  train: { width: 3, dash: [1, 2] },
  bus: { width: 3, dash: [4, 2] },
  walk: { width: 3, dash: [0.5, 2] },
  hike: { width: 5, dash: [1, 1.5] },
  flight: { width: 2, dash: [3, 3] },
}

export function findDay(dayNumber: number): Day | undefined {
  return trip.days.find((d) => d.dayNumber === dayNumber)
}

export function findPlace(id: string): Place | undefined {
  for (const day of trip.days) {
    const hit = day.places.find((p) => p.id === id)
    if (hit) return hit
  }
  return undefined
}

/**
 * Rows for one day's panel. The data holds a multi-night stay only on its
 * check-in day, so it is pulled forward onto later days by the condition
 * `checkIn <= date < checkOut` (FR-PANEL-5).
 */
export function itineraryFor(day: Day): ItineraryItem[] {
  const own = [...day.places]
    .sort((a, b) => a.order - b.order)
    .map((place) => ({ place, carriedOver: false }))

  const ownIds = new Set(day.places.map((p) => p.id))
  const carried = trip.days
    .flatMap((d) => d.places)
    .filter(
      (p) =>
        p.type === 'stay' &&
        !ownIds.has(p.id) &&
        p.checkIn !== undefined &&
        p.checkOut !== undefined &&
        p.checkIn <= day.date &&
        day.date < p.checkOut,
    )
    .map((place) => ({ place, carriedOver: true }))

  return [...own, ...carried]
}

/** Where you sleep that night, or null. */
export function stayFor(day: Day): Place | null {
  return itineraryFor(day).find((i) => i.place.type === 'stay')?.place ?? null
}

export type Bounds = [[number, number], [number, number]]

export function boundsOf(coords: LngLat[]): Bounds | null {
  if (!coords.length) return null
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const [lng, lat] of coords) {
    if (lng < w) w = lng
    if (lng > e) e = lng
    if (lat < s) s = lat
    if (lat > n) n = lat
  }
  return [[w, s], [e, n]]
}

function dayCoords(day: Day): LngLat[] {
  const out: LngLat[] = day.places.map((p) => p.coordinates)
  if (day.route) {
    out.push(...day.route.geometry)
    for (const leg of day.route.legs ?? []) out.push(...leg.geometry)
  }
  return out
}

export function dayBounds(day: Day): Bounds | null {
  return boundsOf(dayCoords(day))
}

export function tripBounds(): Bounds | null {
  return boundsOf(trip.days.flatMap(dayCoords))
}

export function formatDuration(minutes?: number): string | null {
  if (minutes === undefined) return null
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} hr`
  return `${h} hr ${m} min`
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return `${WEEKDAY[d.getDay()]}, ${MONTH[d.getMonth()]} ${d.getDate()}`
}
