/** [lng, lat] — GeoJSON / MapLibre order. NOT [lat, lng]. */
export type LngLat = [number, number]

export type TransportMode =
  | 'car' | 'ferry' | 'train' | 'bus' | 'walk' | 'hike' | 'flight'

export type PlaceType =
  | 'stay' | 'sight' | 'hike' | 'food' | 'transport' | 'activity'

export type NoteKind = 'warning' | 'tip' | 'note'

export type LinkType = 'booking' | 'official' | 'map' | 'info' | 'review'

export interface Note {
  kind: NoteKind
  /** Plain text. Never interpreted as Markdown or HTML (FR-NOTE-6). */
  text: string
}

export interface Link {
  label: string
  url: string
  type: LinkType
}

export interface RouteLeg {
  mode: TransportMode
  /** Place.id */
  from: string
  /** Place.id */
  to: string
  /**
   * The points that define the route. This is the hand-maintained value;
   * `geometry` is generated from it by `npm run routes`.
   */
  waypoints?: LngLat[]
  /** Real road shape. Don't hand-edit — regenerate with `npm run routes`. */
  geometry: LngLat[]
  note?: string
}

export interface Route {
  mode: TransportMode
  distanceKm?: number
  durationMin?: number
  /** Same role as RouteLeg.waypoints, for simple days that have no legs. */
  waypoints?: LngLat[]
  /** Real road shape. Don't hand-edit — regenerate with `npm run routes`. */
  geometry: LngLat[]
  legs?: RouteLeg[]
}

export interface Place {
  id: string
  name: string
  nameLocal?: string
  type: PlaceType
  coordinates: LngLat
  dayNumber: number
  order: number
  description?: string
  imageUrl?: string
  /** Attribution line for `imageUrl`, shown under the photo. Required for Commons images. */
  imageCredit?: string
  /** English Wikipedia article title. `npm run images` pulls the lead photo from it. */
  wikipedia?: string
  checkIn?: string
  checkOut?: string
  nights?: number
  /** Street address, as supplied by the traveller. */
  address?: string
  /** Local clock time, "HH:MM". Set only where the time actually matters. */
  time?: string
  /**
   * Force this place into (true) or out of (false) the tour's stop list,
   * overriding the default by `type`. The departure airport is a `transport`
   * place but has to be the tour's final stop.
   */
  tourStop?: boolean
  durationMin?: number
  priceNote?: string
  tags?: string[]
  links: Link[]
  notes?: Note[]
}

export interface Day {
  dayNumber: number
  /** ISO date */
  date: string
  title: string
  summary?: string
  /** Colour unique to this day */
  color: string
  route?: Route
  places: Place[]
  notes?: Note[]
}

export interface Trip {
  id: string
  title: string
  startDate: string
  nights: number
  region: string
  initialView: {
    center: LngLat
    zoom: number
    bearing?: number
    pitch?: number
  }
  days: Day[]
}

/** One row in the itinerary panel. A multi-night stay arrives as carriedOver on every day after check-in. */
export interface ItineraryItem {
  place: Place
  carriedOver: boolean
}
