import type { LngLat, Place, PlaceType, TransportMode } from '../types'
import { trip } from './trip'

/** Place types the tour stops at. `transport` (airports, tunnels, car parks, stations) is a waypoint, not a destination. */
const STOP_TYPES: PlaceType[] = ['stay', 'sight', 'hike', 'food', 'activity']

/** A gap this wide counts as a break in the route (km). */
const GAP_KM = 1.0

/** How many previous parts to retrace when trying to close a break. */
const MAX_LOOKBACK = 4

/** Distances within this count as "the same spot" (km) when choosing the nearest point. */
const SAME_SPOT_KM = 0.3

/** Playback speed per mode (km/sec). Tuned to look right, not to be realistic. */
export const MODE_SPEED: Record<TransportMode, number> = {
  car: 42, bus: 36, ferry: 18, train: 6, hike: 4.5, walk: 1, flight: 90,
}

/** Follow-camera zoom per mode. */
export const MODE_ZOOM: Record<TransportMode, number> = {
  car: 7.6, bus: 7.6, ferry: 9, train: 10, hike: 11, walk: 13.5, flight: 5.5,
}

/** Retraced stretches are skipped through faster. */
const RETURN_SPEED_FACTOR = 3.5

export interface TourPoint {
  lngLat: LngLat
  /** Cumulative ground distance from the start (km). Drives speed and the progress bar. */
  km: number
  /**
   * Position along the whole route (0..1), measured in **Mercator distance**.
   *
   * MapLibre's `line-progress` measures length in projected space, which is not
   * the same as the ground-distance ratio. The distortion is 1/cos(latitude), so
   * the wider a route's latitude span, the further the two drift apart. On this
   * trip (59.9°-61.1°) they diverge by up to 2.4 km, which put the colour
   * boundary on a road 2.5 km away while the car was on the 1.2 km Bergen walk.
   * Always feed this value to the gradient.
   */
  frac: number
  mode: TransportMode
  dayNumber: number
  /** Whether this stretch retraces ground already covered. */
  returning: boolean
}

export interface TourStop {
  place: Place
  km: number
  dayNumber: number
  dayTitle: string
  color: string
}

export interface Tour {
  points: TourPoint[]
  stops: TourStop[]
  totalKm: number
}

export function haversineKm(a: LngLat, b: LngLat): number {
  const R = 6371
  const [lng1, lat1] = a
  const [lng2, lat2] = b
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dp = p2 - p1
  const dl = ((lng2 - lng1) * Math.PI) / 180
  const h =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Normalised Web Mercator coordinates (0..1) — the space MapLibre measures line-progress in. */
function mercator([lng, lat]: LngLat): [number, number] {
  const s = Math.sin((lat * Math.PI) / 180)
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)]
}

function mercatorDist(a: LngLat, b: LngLat): number {
  const [ax, ay] = mercator(a)
  const [bx, by] = mercator(b)
  return Math.hypot(bx - ax, by - ay)
}

interface Part {
  mode: TransportMode
  dayNumber: number
  geometry: LngLat[]
}

/** Flattens a day's route into legs. When legs exist they are authoritative; route.geometry overlaps legs[0]. */
function flattenParts(): Part[] {
  const parts: Part[] = []
  for (const day of trip.days) {
    const route = day.route
    if (!route) continue
    const legs = route.legs?.length
      ? route.legs.map((l) => ({ mode: l.mode, geometry: l.geometry }))
      : [{ mode: route.mode, geometry: route.geometry }]
    for (const leg of legs) {
      if (leg.geometry.length < 2) continue
      parts.push({ mode: leg.mode, dayNumber: day.dayNumber, geometry: leg.geometry })
    }
  }
  return parts
}

/**
 * Builds one continuous route with no breaks.
 *
 * Out-and-back stretches like the Trolltunga hike or the Flåm Railway exist in
 * the data one way only. Joined as-is, the car teleports to the start of the
 * next part. So when the next part starts far away, the parts just travelled
 * are appended in reverse. If retracing still doesn't reach (a genuine hole in
 * the data), a straight connector is added and flagged as returning so it is
 * crossed quickly.
 */
function buildPoints(parts: Part[]): TourPoint[] {
  const out: TourPoint[] = []
  let km = 0
  let merc = 0

  const push = (lngLat: LngLat, mode: TransportMode, dayNumber: number, returning: boolean) => {
    const prev = out[out.length - 1]
    if (prev) {
      const step = haversineKm(prev.lngLat, lngLat)
      if (step === 0) return // skip repeated identical coordinates
      km += step
      merc += mercatorDist(prev.lngLat, lngLat)
    }
    // frac needs the total length, so it is filled in below.
    out.push({ lngLat, km, frac: merc, mode, dayNumber, returning })
  }

  const pushLine = (geom: LngLat[], mode: TransportMode, day: number, returning: boolean) => {
    for (const c of geom) push(c, mode, day, returning)
  }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    pushLine(part.geometry, part.mode, part.dayNumber, false)

    const next = parts[i + 1]
    if (!next) break

    let pos = part.geometry[part.geometry.length - 1]
    const target = next.geometry[0]

    for (let k = 0; k < MAX_LOOKBACK && haversineKm(pos, target) > GAP_KM; k++) {
      const back = parts[i - k]
      if (!back) break
      const reversed = [...back.geometry].reverse()
      pushLine(reversed, back.mode, back.dayNumber, true)
      pos = reversed[reversed.length - 1]
    }

    if (haversineKm(pos, target) > GAP_KM) {
      // Retracing didn't reach it. Join with a straight line.
      push(target, next.mode, next.dayNumber, true)
    }
  }

  // frac has been holding raw cumulative Mercator distance. Normalise it to 0..1.
  const totalMerc = out[out.length - 1]?.frac ?? 0
  if (totalMerc > 0) for (const p of out) p.frac /= totalMerc

  return out
}

/**
 * Finds how far along the route each stop sits.
 *
 * The search must be confined to the day the place belongs to. Picking the
 * nearest point across the whole route lands the Oslo sights on Day 7's return
 * leg (the 1079 km mark), because the loop passes through the same city twice.
 *
 * Returning stretches are excluded too. Otherwise the Odda hotel matches the
 * retrace coming down from Trolltunga.
 *
 * Itinerary order (day, then order) is preserved: a stop whose km falls below
 * the previous one is pulled up to it, so the car never travels backwards. When
 * several places land on effectively the same point — the Oslo city sights —
 * the car stays put and only the cards advance.
 */
function projectStops(points: TourPoint[]): TourStop[] {
  const forward = points.filter((p) => !p.returning)
  const stops: TourStop[] = []
  let minKm = 0

  for (const day of trip.days) {
    const places = [...day.places]
      .filter((p) => p.tourStop ?? STOP_TYPES.includes(p.type))
      .sort((a, b) => a.order - b.order)
    if (places.length === 0) continue

    // If the day has no route of its own, fall back to the whole path.
    const sameDay = forward.filter((p) => p.dayNumber === day.dayNumber)
    const candidates = sameDay.length > 0 ? sameDay : forward

    for (const place of places) {
      // Only consider candidates at or beyond the previous stop.
      const ahead = candidates.filter((p) => p.km >= minKm)
      const pool = ahead.length > 0 ? ahead : candidates

      let bestDist = Infinity
      for (const p of pool) {
        const d = haversineKm(p.lngLat, place.coordinates)
        if (d < bestDist) bestDist = d
      }
      // Among near-equal distances, take the earliest point. The Flåm hotel's
      // coordinates exactly match the start of a later leg, so going purely by
      // nearest point placed it after the Stegastein detour and flipped the
      // visiting order.
      let best = pool[0]
      let bestKm = Infinity
      for (const p of pool) {
        const d = haversineKm(p.lngLat, place.coordinates)
        if (d <= bestDist + SAME_SPOT_KM && p.km < bestKm) { bestKm = p.km; best = p }
      }
      const km = Math.max(best?.km ?? 0, minKm)
      minKm = km
      stops.push({
        place,
        km,
        dayNumber: day.dayNumber,
        dayTitle: day.title,
        color: day.color,
      })
    }
  }
  return stops
}

let cached: Tour | null = null

export function getTour(): Tour {
  if (cached) return cached
  const points = buildPoints(flattenParts())
  cached = {
    points,
    stops: projectStops(points),
    totalKm: points[points.length - 1]?.km ?? 0,
  }
  return cached
}

export interface TourPosition {
  lngLat: LngLat
  /** Mercator-based progress (0..1). Pass straight to line-gradient. */
  frac: number
  mode: TransportMode
  dayNumber: number
  returning: boolean
}

/** Position at a cumulative distance, linearly interpolated between points. */
export function positionAt(tour: Tour, km: number): TourPosition {
  const pts = tour.points
  if (pts.length === 0) {
    return { lngLat: [0, 0], frac: 0, mode: 'car', dayNumber: 1, returning: false }
  }
  const target = Math.max(0, Math.min(km, tour.totalKm))

  let lo = 0
  let hi = pts.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (pts[mid].km < target) lo = mid + 1
    else hi = mid
  }
  const b = pts[lo]
  const a = pts[lo - 1] ?? b
  const span = b.km - a.km
  const t = span > 0 ? (target - a.km) / span : 0
  return {
    lngLat: [
      a.lngLat[0] + (b.lngLat[0] - a.lngLat[0]) * t,
      a.lngLat[1] + (b.lngLat[1] - a.lngLat[1]) * t,
    ],
    frac: a.frac + (b.frac - a.frac) * t,
    mode: b.mode,
    dayNumber: b.dayNumber,
    returning: b.returning,
  }
}

/** Playback speed at the current position (km/sec). */
export function speedAt(pos: TourPosition, multiplier: number): number {
  const base = MODE_SPEED[pos.mode] ?? MODE_SPEED.car
  return base * multiplier * (pos.returning ? RETURN_SPEED_FACTOR : 1)
}
