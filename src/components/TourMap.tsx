import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type LngLatBoundsLike } from 'maplibre-gl'
import { useMapLibre, type Theme } from '../lib/useMapLibre'
import { MODE_ZOOM, getTour, positionAt, speedAt, type Tour } from '../lib/tour'
import { MODE_ICON, boundsOf, trip } from '../lib/trip'
import TourCard from './TourCard'

/** How long the tour pauses at each stop (ms). */
const STOP_PAUSE_MS = 3400
/** Opacity for stretches not yet reached — the same day colour, laid down faintly. */
const AHEAD_ALPHA = 0.22
/** Gradient refresh interval (ms). Rebuilding the expression every frame is costly. */
const GRADIENT_MS = 100
/** Cap on a single step (sec), so returning to the tab doesn't jump the car forward. */
const MAX_DT = 0.25
/** How fast zoom eases toward its target, so mode changes aren't abrupt. */
const ZOOM_EASE = 0.05

const SOURCE = 'tour'
const LINE_LAYER = 'tour-line'

interface Band { from: number; to: number; color: string; faded: string }

function dayColor(dayNumber: number): string {
  return trip.days.find((d) => d.dayNumber === dayNumber)?.color ?? '#888888'
}

/** The same colour, faded. Keeping the hue (rather than greying out) lets the whole route read in advance. */
function fade(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return `rgba(150, 158, 170, ${AHEAD_ALPHA})`
  const n = Number.parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${AHEAD_ALPHA})`
}

/**
 * Splits the route into per-day bands, the basis of the progress gradient.
 * Boundaries must use `frac` (Mercator) to line up with line-progress.
 */
function buildBands(tour: Tour): Band[] {
  const bands: Band[] = []
  if (tour.points.length === 0) return bands
  let start = 0
  let day = tour.points[0].dayNumber
  for (const p of tour.points) {
    if (p.dayNumber !== day) {
      const color = dayColor(day)
      bands.push({ from: start, to: p.frac, color, faded: fade(color) })
      start = p.frac
      day = p.dayNumber
    }
  }
  const color = dayColor(day)
  bands.push({ from: start, to: 1, color, faded: fade(color) })
  return bands
}

/**
 * Paints covered ground in the full day colour and what's left in a faded one.
 * The source needs lineMetrics enabled for line-progress to work.
 *
 * `progress` must be Mercator-based (TourPosition.frac). Passing a ground
 * distance ratio puts the colour boundary up to 2.4 km away from the car.
 */
function gradientFor(bands: Band[], progress: number): maplibregl.ExpressionSpecification {
  const pairs: Array<[number, string]> = []
  const add = (at: number, color: string) => {
    const last = pairs[pairs.length - 1]
    // step boundaries must strictly increase; if not, overwrite the last one.
    if (last && at <= last[0]) { last[1] = color; return }
    pairs.push([at, color])
  }
  for (const band of bands) {
    if (band.to <= progress) add(band.from, band.color)
    else if (band.from >= progress) add(band.from, band.faded)
    else { add(band.from, band.color); add(progress, band.faded) }
  }
  const fallback = bands[0]?.faded ?? `rgba(150, 158, 170, ${AHEAD_ALPHA})`
  const expr: unknown[] = ['step', ['line-progress'], pairs[0]?.[1] ?? fallback]
  for (let i = 1; i < pairs.length; i++) expr.push(pairs[i][0], pairs[i][1])
  return expr as maplibregl.ExpressionSpecification
}

interface Props {
  theme: Theme
}

export default function TourMap({ theme }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const tour = useMemo(() => getTour(), [])
  const bands = useMemo(() => buildBands(tour), [tour])

  const { mapRef, ready } = useMapLibre(containerRef, {
    theme,
    center: trip.initialView.center,
    zoom: trip.initialView.zoom,
  })

  // ── Animation state lives in refs. Re-rendering React every frame would be slow.
  const kmRef = useRef(0)
  const playingRef = useRef(false)
  const speedRef = useRef(1)
  const pauseUntilRef = useRef(0)
  const nextStopRef = useRef(0)
  const lastTsRef = useRef(0)
  const lastGradientRef = useRef(-1)
  const zoomRef = useRef(trip.initialView.zoom)
  const followingRef = useRef(false)
  const rafRef = useRef(0)
  const arrivedRef = useRef(false)

  const carRef = useRef<maplibregl.Marker | null>(null)
  const carIconRef = useRef<HTMLSpanElement | null>(null)
  const carModeRef = useRef('')
  const railFillRef = useRef<HTMLDivElement>(null)

  // ── Only what the UI displays is React state.
  const [playing, setPlaying] = useState(false)
  const [stopIndex, setStopIndex] = useState(-1)
  const [arrived, setArrived] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [finished, setFinished] = useState(false)

  const overviewBounds = useMemo(
    () => boundsOf(tour.points.map((p) => p.lngLat)),
    [tour],
  )

  // ── Source and layers. Must be re-added after setStyle (theme change).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    const install = () => {
      if (!map.getSource(SOURCE)) {
        map.addSource(SOURCE, {
          type: 'geojson',
          lineMetrics: true, // required for line-progress
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: tour.points.map((p) => p.lngLat),
            },
          },
        })
      }
      if (!map.getLayer(LINE_LAYER)) {
        map.addLayer({
          id: LINE_LAYER,
          type: 'line',
          source: SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-width': 5,
            'line-gradient': gradientFor(bands, positionAt(tour, kmRef.current).frac),
          },
        })
      }
      lastGradientRef.current = -1
    }
    install()
    map.on('styledata', install)
    return () => {
      if (mapRef.current === map) map.off('styledata', install)
    }
  }, [ready, mapRef, tour, bands])

  // ── The car marker and the stop markers
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    const el = document.createElement('div')
    el.className = 'car'
    const icon = document.createElement('span')
    icon.className = 'car__icon'
    icon.textContent = MODE_ICON.car
    el.append(icon)
    carIconRef.current = icon
    const car = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat(tour.points[0]?.lngLat ?? [0, 0])
      .addTo(map)
    carRef.current = car

    const markers = tour.stops.map((stop, i) => {
      const node = document.createElement('button')
      node.type = 'button'
      node.className = 'tourstop'
      node.style.setProperty('--day-color', stop.color)
      node.title = stop.place.name
      // MapLibre positions the outer element via transform. A transition or a
      // scale here makes markers lag and swim every time the camera moves.
      const inner = document.createElement('span')
      inner.className = 'tourstop__inner'
      inner.textContent = String(i + 1)
      node.append(inner)
      node.addEventListener('click', (e) => {
        e.stopPropagation()
        seekToRef.current(i)
      })
      return new maplibregl.Marker({ element: node, anchor: 'center' })
        .setLngLat(stop.place.coordinates)
        .addTo(map)
    })

    // Dragging the map stops the follow, otherwise it fights the camera.
    const onDrag = () => { playingRef.current = false; setPlaying(false) }
    map.on('dragstart', onDrag)

    return () => {
      // React runs cleanups in declaration order, and useMapLibre's effect is
      // registered first — so on unmount the map is already destroyed by the time
      // this runs. The hook nulls mapRef when it tears down, which is the signal
      // that everything below went with it. Touching a removed map throws
      // (NavigationControl.onRemove reaches into internals that are gone).
      carRef.current = null
      if (mapRef.current !== map) return
      map.off('dragstart', onDrag)
      car.remove()
      for (const m of markers) m.remove()
    }
  }, [ready, mapRef, tour])

  // ── First view: show the whole route.
  const didOverviewRef = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || didOverviewRef.current || !overviewBounds) return
    didOverviewRef.current = true
    map.fitBounds(overviewBounds as LngLatBoundsLike, { padding: 60, duration: 0 })
  }, [ready, mapRef, overviewBounds])

  // ── Per-frame draw
  const draw = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const pos = positionAt(tour, kmRef.current)

    carRef.current?.setLngLat(pos.lngLat)
    if (carIconRef.current && carModeRef.current !== pos.mode) {
      carModeRef.current = pos.mode
      carIconRef.current.textContent = MODE_ICON[pos.mode]
    }

    if (followingRef.current) {
      const target = MODE_ZOOM[pos.mode] ?? MODE_ZOOM.car
      const gap = target - zoomRef.current
      // Snap once it's close. Purely exponential approach means zoom keeps
      // changing forever, reprojecting markers into a faint permanent jitter.
      zoomRef.current = Math.abs(gap) < 0.002 ? target : zoomRef.current + gap * ZOOM_EASE
      map.jumpTo({ center: pos.lngLat, zoom: zoomRef.current })
    }

    // The progress bar answers "how far have I come", so ground distance is right.
    if (railFillRef.current) {
      railFillRef.current.style.width = `${(kmRef.current / (tour.totalKm || 1)) * 100}%`
    }
    // The gradient must use the same space as line-progress (Mercator).
    const now = performance.now()
    if (now - lastGradientRef.current > GRADIENT_MS && map.getLayer(LINE_LAYER)) {
      lastGradientRef.current = now
      map.setPaintProperty(LINE_LAYER, 'line-gradient', gradientFor(bands, pos.frac))
    }
  }, [mapRef, tour, bands])

  // ── Sync once the map is ready.
  // The controls render before the map does. If a stop was picked in between,
  // the car position, its icon and the progress bar would stay at their defaults.
  useEffect(() => {
    if (ready) draw()
  }, [ready, draw])

  // ── Animation loop
  useEffect(() => {
    if (!ready) return
    const frame = (ts: number) => {
      rafRef.current = requestAnimationFrame(frame)
      const dt = Math.min(MAX_DT, (ts - (lastTsRef.current || ts)) / 1000)
      lastTsRef.current = ts

      if (!playingRef.current) return
      if (ts < pauseUntilRef.current) return
      if (arrivedRef.current) { arrivedRef.current = false; setArrived(false) }

      const pos = positionAt(tour, kmRef.current)
      let next = kmRef.current + speedAt(pos, speedRef.current) * dt

      const stop = tour.stops[nextStopRef.current]
      if (stop && next >= stop.km) {
        next = stop.km
        const idx = nextStopRef.current
        nextStopRef.current = idx + 1
        pauseUntilRef.current = ts + STOP_PAUSE_MS
        arrivedRef.current = true
        setStopIndex(idx)
        setArrived(true)
      }

      if (next >= tour.totalKm) {
        next = tour.totalKm
        playingRef.current = false
        setPlaying(false)
        setFinished(true)
      }
      kmRef.current = next
      draw()
    }
    rafRef.current = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafRef.current)
  }, [ready, tour, draw])

  // ── Controls
  const startFollowing = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const pos = positionAt(tour, kmRef.current)
    const target = MODE_ZOOM[pos.mode] ?? MODE_ZOOM.car
    zoomRef.current = target
    followingRef.current = true
    map.easeTo({ center: pos.lngLat, zoom: target, duration: 700 })
  }, [mapRef, tour])

  const play = useCallback(() => {
    if (finished) return
    if (!followingRef.current) startFollowing()
    lastTsRef.current = 0
    playingRef.current = true
    setPlaying(true)
  }, [finished, startFollowing])

  const pause = useCallback(() => {
    playingRef.current = false
    setPlaying(false)
  }, [])

  const seekTo = useCallback((index: number) => {
    const stop = tour.stops[index]
    if (!stop) return
    kmRef.current = stop.km
    nextStopRef.current = index + 1
    pauseUntilRef.current = performance.now() + STOP_PAUSE_MS
    arrivedRef.current = true
    setStopIndex(index)
    setArrived(true)
    setFinished(false)
    if (!followingRef.current) startFollowing()
    else {
      const map = mapRef.current
      const pos = positionAt(tour, stop.km)
      zoomRef.current = MODE_ZOOM[pos.mode] ?? MODE_ZOOM.car
      map?.easeTo({ center: pos.lngLat, zoom: zoomRef.current, duration: 500 })
    }
    draw()
  }, [tour, startFollowing, mapRef, draw])

  const seekToRef = useRef(seekTo)
  seekToRef.current = seekTo

  const restart = useCallback(() => {
    kmRef.current = 0
    nextStopRef.current = 0
    pauseUntilRef.current = 0
    arrivedRef.current = false
    followingRef.current = false
    playingRef.current = false
    setPlaying(false)
    setStopIndex(-1)
    setArrived(false)
    setFinished(false)
    const map = mapRef.current
    if (map && overviewBounds) {
      map.fitBounds(overviewBounds as LngLatBoundsLike, { padding: 60, duration: 700 })
    }
    draw()
  }, [mapRef, overviewBounds, draw])

  const showOverview = useCallback(() => {
    pause()
    followingRef.current = false
    const map = mapRef.current
    if (map && overviewBounds) {
      map.fitBounds(overviewBounds as LngLatBoundsLike, { padding: 60, duration: 700 })
    }
  }, [mapRef, overviewBounds, pause])

  const cycleSpeed = useCallback(() => {
    const next = speed === 1 ? 2 : speed === 2 ? 4 : 1
    setSpeed(next)
    speedRef.current = next
  }, [speed])

  // Space toggles play/pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return
      if (e.code === 'Space') { e.preventDefault(); playingRef.current ? pause() : play() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seekTo(Math.min(stopIndex + 1, tour.stops.length - 1)) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo(Math.max(stopIndex - 1, 0)) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [play, pause, seekTo, stopIndex, tour.stops.length])

  // Restyle the stop markers by visited state.
  // `ready` has to be a dependency: markers are created after the map is ready,
  // so a stopIndex change before that would iterate an empty list.
  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>('.tourstop')
    nodes.forEach((node, i) => {
      node.classList.toggle('tourstop--visited', i <= stopIndex)
      node.classList.toggle('tourstop--current', i === stopIndex)
    })
  }, [stopIndex, ready])

  // Only show the card while actually stopped. Leaving it up during the drive
  // means the screen describes a place the car has already left.
  const current = arrived && stopIndex >= 0 ? tour.stops[stopIndex] : null
  const upcoming = !arrived && stopIndex + 1 < tour.stops.length
    ? tour.stops[stopIndex + 1]
    : null
  const showUpcoming = upcoming !== null && (playing || stopIndex >= 0)

  return (
    <div className="tour">
      <div ref={containerRef} className="tour__canvas" />

      {current && (
        <TourCard
          stop={current}
          index={stopIndex}
          total={tour.stops.length}
          arrived={arrived}
        />
      )}

      {showUpcoming && (
        <div
          className="tour__next"
          style={{ '--day-color': upcoming.color } as React.CSSProperties}
        >
          <span className="tour__nextLabel">Next</span>
          <span className="tour__nextName">{upcoming.place.name}</span>
        </div>
      )}

      {stopIndex < 0 && !playing && (
        <div className="tour__intro">
          <p className="tour__introTitle">{trip.title}</p>
          <p className="tour__introSub">
            {trip.region} · {trip.days.length} days · {Math.round(tour.totalKm)} km
          </p>
          <button type="button" className="tour__start" onClick={play}>
            ▶ Start the trip
          </button>
        </div>
      )}

      <div className="tour__controls">
        <button
          type="button"
          className="tour__btn tour__btn--primary"
          onClick={playing ? pause : play}
          disabled={finished}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button type="button" className="tour__btn" onClick={() => seekTo(Math.max(stopIndex - 1, 0))} aria-label="Previous stop">
          ⏮
        </button>
        <button
          type="button"
          className="tour__btn"
          onClick={() => seekTo(Math.min(stopIndex + 1, tour.stops.length - 1))}
          aria-label="Next stop"
        >
          ⏭
        </button>
        <button type="button" className="tour__btn" onClick={restart} aria-label="Start over">↺</button>
        <button type="button" className="tour__btn tour__btn--wide" onClick={cycleSpeed} aria-label="Playback speed">
          {speed}×
        </button>
        <button type="button" className="tour__btn tour__btn--wide" onClick={showOverview}>
          Overview
        </button>

        <div className="tour__rail">
          <div ref={railFillRef} className="tour__railFill" />
          {tour.stops.map((stop, i) => (
            <button
              key={stop.place.id}
              type="button"
              className={`tour__dot${i <= stopIndex ? ' tour__dot--visited' : ''}`}
              style={{
                left: `${(stop.km / (tour.totalKm || 1)) * 100}%`,
                '--day-color': stop.color,
              } as React.CSSProperties}
              onClick={() => seekTo(i)}
              title={`${i + 1}. ${stop.place.name}`}
              aria-label={`${i + 1}. ${stop.place.name}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
