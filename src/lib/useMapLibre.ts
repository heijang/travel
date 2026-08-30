import { useEffect, useRef, useState, type RefObject } from 'react'
import maplibregl, { type Map as MlMap } from 'maplibre-gl'

export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

interface Options {
  center: [number, number]
  zoom: number
  interactive?: boolean
}

/**
 * Creates a MapLibre map and reports when it is ready to take layers.
 *
 * Two conditions have to hold at creation time, which is why this lives in a
 * hook — if each screen (itinerary / tour) rolled its own, both would fall into
 * the same traps.
 *
 * 1. Don't create it immediately. StrictMode mounts twice in development, and
 *    creating a map only to remove() it right away tears down the MapLibre
 *    worker pool while the second map is being built, which leaves tile
 *    processing dead. Deferring past a timer means the first mount never
 *    creates one at all. A timer, not rAF: rAF does not fire in a background tab.
 *
 * 2. Wait until the container has a size. Created at 0x0, MapLibre assumes a
 *    default 400x300 viewport and every camera calculation is made against
 *    that, leaving the map wildly zoomed out.
 *
 * Readiness is signalled by 'style.load', not 'load'. The liberty style's
 * hillshade raster is heavy enough that 'load' arrives late or never. Adding
 * layers only needs 'style.load'.
 */
export function useMapLibre(
  containerRef: RefObject<HTMLDivElement | null>,
  { center, zoom, interactive = true }: Options,
) {
  const mapRef = useRef<MlMap | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapRef.current) return

    let cancelled = false
    let timer = 0
    let observer: ResizeObserver | null = null

    const createMap = () => {
      const map = new maplibregl.Map({
        container,
        style: STYLE_URL,
        center,
        zoom,
        interactive,
        attributionControl: { compact: true },
      })
      mapRef.current = map
      map.on('error', (e) => console.error('[maplibre]', e.error?.message ?? e))
      if (import.meta.env.DEV) {
        ;(window as unknown as { __map?: MlMap }).__map = map
      }

      const markReady = () => {
        map.resize()
        setReady(true)
      }
      if (map.isStyleLoaded()) markReady()
      else map.once('style.load', markReady)

      observer = new ResizeObserver(() => map.resize())
      observer.observe(container)
    }

    const attempt = () => {
      if (cancelled || mapRef.current) return
      // A background tab defers layout, so this keeps reading 0. Create the
      // map once the tab becomes visible and the size lands.
      if (container.clientWidth === 0 || container.clientHeight === 0) {
        timer = window.setTimeout(attempt, 50)
        return
      }
      createMap()
    }
    timer = window.setTimeout(attempt, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      observer?.disconnect()
      mapRef.current?.remove()
      mapRef.current = null
      setReady(false)
    }
    // Initial camera and `interactive` are read once, at creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { mapRef, ready }
}
