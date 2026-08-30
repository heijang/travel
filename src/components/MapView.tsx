import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import maplibregl, { type LngLatBoundsLike } from 'maplibre-gl'
import type { Feature, FeatureCollection, LineString } from 'geojson'
import type { Place } from '../types'
import { useMapLibre } from '../lib/useMapLibre'
import {
  MODE_LINE, PLACE_ICON, dayBounds, findDay, findPlace,
  strongestNoteKind, trip, tripBounds, NOTE_ICON,
} from '../lib/trip'

const ROUTE_SOURCE = 'trip-routes'
const ARROW_LAYER = 'route-arrows'
/** Spacing between arrows (px). Lower means denser. */
const ARROW_SPACING = 120
const FIT_BASE_PADDING = 48

/**
 * On mobile the itinerary panel overlays the map as a bottom sheet. Without its
 * height in the bottom padding, the route and markers hide behind it.
 */
function fitPadding(container: HTMLElement) {
  const base = FIT_BASE_PADDING
  const panel = document.querySelector('.panel')
  let bottom = base
  if (panel) {
    const c = container.getBoundingClientRect()
    const p = panel.getBoundingClientRect()
    // Only count it as overlap when it covers most of the width (on desktop it sits alongside).
    const overlapX = Math.min(c.right, p.right) - Math.max(c.left, p.left)
    const overlapY = Math.min(c.bottom, p.bottom) - Math.max(c.top, p.top)
    if (overlapX > c.width * 0.5 && overlapY > 0) bottom += overlapY
  }
  // MapLibre throws when the padding exceeds the viewport.
  const maxV = Math.max(0, container.clientHeight / 2 - 1)
  const maxH = Math.max(0, container.clientWidth / 2 - 1)
  return {
    top: Math.min(base, maxV),
    bottom: Math.min(bottom, maxV),
    left: Math.min(base, maxH),
    right: Math.min(base, maxH),
  }
}

/**
 * Direction arrow icon. Drawn as a triangle pointing right (east),
 * symbol-placement: 'line' rotates it to follow the direction of travel.
 *
 * The white outline matters because on dashed stretches the arrow lands on the
 * background rather than the line, and a pale arrow would vanish on a light map.
 */
function arrowImage(color: string, pixelRatio: number) {
  const s = 16
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = s * pixelRatio
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(pixelRatio, pixelRatio)
  ctx.beginPath()
  ctx.moveTo(s * 0.30, s * 0.20)
  ctx.lineTo(s * 0.76, s * 0.50)
  ctx.lineTo(s * 0.30, s * 0.80)
  ctx.closePath()
  ctx.lineJoin = 'round'
  ctx.lineWidth = 3.2
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
  ctx.stroke()
  ctx.fillStyle = color
  ctx.fill()
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { data: new Uint8Array(data), width, height }
}

function arrowImageId(dayNumber: number) {
  return `route-arrow-${dayNumber}`
}

/** One line feature per leg, or per route when there are no legs. */
function buildRouteFeatures(): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = []
  for (const day of trip.days) {
    const route = day.route
    if (!route) continue
    // When legs exist, use only those — route.geometry can duplicate legs[0].
    const parts = route.legs?.length
      ? route.legs.map((l) => ({ mode: l.mode, geometry: l.geometry }))
      : [{ mode: route.mode, geometry: route.geometry }]
    for (const [i, part] of parts.entries()) {
      features.push({
        type: 'Feature',
        id: day.dayNumber * 100 + i,
        properties: { dayNumber: day.dayNumber, mode: part.mode, color: day.color },
        geometry: { type: 'LineString', coordinates: part.geometry },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

function routeOpacity(selectedDay: number | null): maplibregl.ExpressionSpecification | number {
  if (selectedDay === null) return 0.85
  return ['case', ['==', ['get', 'dayNumber'], selectedDay], 1, 0.12]
}

function buildMarkerElement(place: Place): HTMLElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = `marker marker--${place.type}`
  el.title = place.name
  el.setAttribute('aria-label', place.name)

  // MapLibre positions the outer element via transform. Scaling and opacity
  // must go on the inner wrapper or the marker drifts off its coordinates.
  const inner = document.createElement('span')
  inner.className = 'marker__inner'
  el.append(inner)

  const pin = document.createElement('span')
  pin.className = 'marker__pin'
  pin.textContent = PLACE_ICON[place.type]
  inner.append(pin)

  // A stay with a photo shows it instead of the icon.
  //
  // The photo is attached straight away and reverted on error, rather than
  // being held back until it loads. An <img> that is not in the document never
  // loads under loading="lazy" — lazy loading waits for the viewport, and a
  // detached element never enters it — so waiting for `load` before appending
  // deadlocks and the marker keeps the icon forever.
  if (place.imageUrl) {
    const img = document.createElement('img')
    img.className = 'marker__img'
    img.alt = ''
    img.addEventListener('error', () => {
      img.remove()
      pin.classList.remove('marker__pin--photo')
      el.classList.remove('marker--photo')
      pin.textContent = PLACE_ICON[place.type]
    })
    pin.classList.add('marker__pin--photo')
    el.classList.add('marker--photo')
    pin.textContent = ''
    pin.append(img)
    img.src = place.imageUrl
  }

  // Stays render larger, with a night-count badge (FR-MAP-6)
  if (place.type === 'stay' && place.nights) {
    const nights = document.createElement('span')
    nights.className = 'marker__nights'
    nights.textContent = `${place.nights}N`
    inner.append(nights)
  }

  // A note badge shows only the strongest kind (FR-MAP-9 / FR-NOTE-4)
  const kind = strongestNoteKind(place.notes)
  if (kind) {
    const badge = document.createElement('span')
    badge.className = `marker__note marker__note--${kind}`
    badge.textContent = NOTE_ICON[kind]
    inner.append(badge)
  }
  return el
}

interface Props {
  selectedDay: number | null
  selectedPlaceId: string | null
  hoveredPlaceId: string | null
  onSelectPlace: (id: string | null) => void
  renderPopup: (place: Place) => React.ReactNode
}

export default function MapView({
  selectedDay, selectedPlaceId, hoveredPlaceId, onSelectPlace, renderPopup,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const popupHostRef = useRef<HTMLDivElement | null>(null)
  const [popupPlace, setPopupPlace] = useState<Place | null>(null)

  const { mapRef, ready } = useMapLibre(containerRef, {
    center: trip.initialView.center,
    zoom: trip.initialView.zoom,
  })

  // Callbacks live in refs so effects don't re-run on every render.
  const onSelectRef = useRef(onSelectPlace)
  onSelectRef.current = onSelectPlace
  const selectedDayRef = useRef(selectedDay)
  selectedDayRef.current = selectedDay

  // ── Controls and popup
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    const nav = new maplibregl.NavigationControl({ visualizePitch: true })
    const scale = new maplibregl.ScaleControl({ unit: 'metric' })
    map.addControl(nav, 'top-right')
    map.addControl(scale, 'bottom-left')

    const host = document.createElement('div')
    popupHostRef.current = host
    const popup = new maplibregl.Popup({
      closeButton: true, closeOnClick: false, maxWidth: '320px', offset: 18,
    }).setDOMContent(host)
    popup.on('close', () => onSelectRef.current(null))
    popupRef.current = popup

    return () => {
      // React runs cleanups in declaration order, and useMapLibre's effect is
      // registered first — so on unmount the map is already destroyed by the time
      // this runs. The hook nulls mapRef when it tears down, which is the signal
      // that everything below went with it. Touching a removed map throws
      // (NavigationControl.onRemove reaches into internals that are gone).
      popupRef.current = null
      if (mapRef.current !== map) return
      popup.remove()
      map.removeControl(nav)
      map.removeControl(scale)
    }
  }, [ready, mapRef])

  // ── Register source and layers. Must be re-added after setStyle (theme change).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    const install = () => {
      if (!map.getSource(ROUTE_SOURCE)) {
        map.addSource(ROUTE_SOURCE, { type: 'geojson', data: buildRouteFeatures() })
      }
      for (const [mode, style] of Object.entries(MODE_LINE)) {
        const id = `route-${mode}`
        if (map.getLayer(id)) continue
        map.addLayer({
          id,
          type: 'line',
          source: ROUTE_SOURCE,
          filter: ['==', ['get', 'mode'], mode],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': style.width,
            'line-opacity': routeOpacity(selectedDayRef.current),
            ...(style.dash ? { 'line-dasharray': style.dash } : {}),
          },
        })
      }

      // Direction arrows (FR-MAP-8). One image per day, since each has its own
      // colour. setStyle also clears registered images, so re-check and re-add here.
      const pixelRatio = Math.min(2, Math.ceil(window.devicePixelRatio || 1))
      for (const day of trip.days) {
        const id = arrowImageId(day.dayNumber)
        if (map.hasImage(id)) continue
        const img = arrowImage(day.color, pixelRatio)
        if (img) map.addImage(id, img, { pixelRatio })
      }
      if (!map.getLayer(ARROW_LAYER)) {
        map.addLayer({
          id: ARROW_LAYER,
          type: 'symbol',
          source: ROUTE_SOURCE,
          layout: {
            'symbol-placement': 'line',
            'symbol-spacing': ARROW_SPACING,
            'icon-image': ['concat', 'route-arrow-', ['to-string', ['get', 'dayNumber']]],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'icon-padding': 0,
          },
          paint: { 'icon-opacity': routeOpacity(selectedDayRef.current) },
        })
      }
    }
    install()
    map.on('styledata', install)
    return () => {
      if (mapRef.current === map) map.off('styledata', install)
    }
  }, [ready, mapRef])

  // ── Create markers, once
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    for (const day of trip.days) {
      for (const place of day.places) {
        if (markersRef.current.has(place.id)) continue
        const el = buildMarkerElement(place)
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          onSelectRef.current(place.id)
        })
        markersRef.current.set(
          place.id,
          new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat(place.coordinates)
            .addTo(map),
        )
      }
    }
    const clear = () => onSelectRef.current(null)
    map.on('click', clear)
    const markers = markersRef.current
    return () => {
      if (mapRef.current === map) {
        map.off('click', clear)
        for (const m of markers.values()) m.remove()
      }
      markers.clear()
    }
  }, [ready, mapRef])

  // ── Highlight the selected day and move the camera (FR-DAY-2, FR-DAY-3)
  //
  // The first fit runs without animation: a ResizeObserver resize() landing
  // mid-flight would throw off where the camera ends up.
  const didInitialFitRef = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    for (const mode of Object.keys(MODE_LINE)) {
      const id = `route-${mode}`
      if (map.getLayer(id)) {
        map.setPaintProperty(id, 'line-opacity', routeOpacity(selectedDay))
      }
    }
    if (map.getLayer(ARROW_LAYER)) {
      map.setPaintProperty(ARROW_LAYER, 'icon-opacity', routeOpacity(selectedDay))
    }
    for (const [id, marker] of markersRef.current) {
      const place = findPlace(id)
      const dimmed = selectedDay !== null && place?.dayNumber !== selectedDay
      marker.getElement().classList.toggle('marker--dimmed', dimmed)
    }

    const bounds = selectedDay === null ? tripBounds() : dayBounds(findDay(selectedDay)!)
    if (bounds) {
      const first = !didInitialFitRef.current
      didInitialFitRef.current = true
      map.fitBounds(bounds as LngLatBoundsLike, {
        padding: fitPadding(map.getContainer()),
        duration: first ? 0 : 800,
        maxZoom: 12,
      })
    }
  }, [selectedDay, ready, mapRef])

  // ── List hover ↔ marker highlight (FR-PLACE-6)
  useEffect(() => {
    for (const [id, marker] of markersRef.current) {
      marker.getElement().classList.toggle('marker--hovered', id === hoveredPlaceId)
    }
  }, [hoveredPlaceId])

  // ── Popup for the selected place (FR-PLACE-1)
  useEffect(() => {
    const map = mapRef.current
    const popup = popupRef.current
    if (!map || !popup || !ready) return

    for (const [id, marker] of markersRef.current) {
      marker.getElement().classList.toggle('marker--active', id === selectedPlaceId)
    }

    if (!selectedPlaceId) {
      popup.remove()
      setPopupPlace(null)
      return
    }
    const place = findPlace(selectedPlaceId)
    if (!place) return
    setPopupPlace(place)
    popup.setLngLat(place.coordinates).addTo(map)
    map.easeTo({ center: place.coordinates, duration: 500, offset: [0, 80] })
  }, [selectedPlaceId, ready, mapRef])

  const resetView = () => {
    const map = mapRef.current
    const b = tripBounds()
    if (map && b) {
      map.fitBounds(b as LngLatBoundsLike, {
        padding: fitPadding(map.getContainer()), duration: 800,
      })
    }
  }

  return (
    <div className="map">
      <div ref={containerRef} className="map__canvas" />
      <button type="button" className="map__reset" onClick={resetView}>
        Fit all
      </button>
      {popupPlace && popupHostRef.current
        ? createPortal(renderPopup(popupPlace), popupHostRef.current)
        : null}
    </div>
  )
}
