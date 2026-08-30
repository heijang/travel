import { useCallback, useEffect, useMemo, useState } from 'react'
import MapView from './components/MapView'
import DayTabs from './components/DayTabs'
import ItineraryPanel from './components/ItineraryPanel'
import PlaceDetail from './components/PlaceDetail'
import TourMap from './components/TourMap'
import { findPlace, trip } from './lib/trip'
import type { Theme } from './lib/useMapLibre'

type ViewMode = 'tour' | 'detail'

function readParams() {
  const q = new URLSearchParams(window.location.search)
  const rawDay = q.get('day')
  const day = rawDay !== null && trip.days.some((d) => d.dayNumber === Number(rawDay))
    ? Number(rawDay)
    : null
  // A ?day= link was aimed at the itinerary view.
  const view: ViewMode = q.get('view') === 'detail' || day !== null ? 'detail' : 'tour'
  return { day, view }
}

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function App() {
  const initial = useMemo(readParams, [])
  const [view, setView] = useState<ViewMode>(initial.view)
  const [selectedDay, setSelectedDay] = useState<number | null>(initial.day)
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null)
  const [hoveredPlaceId, setHoveredPlaceId] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(systemTheme)
  const [panelOpen, setPanelOpen] = useState(true)

  // Follow the system theme until the user toggles, then keep their choice.
  const [themeLocked, setThemeLocked] = useState(false)
  useEffect(() => {
    if (themeLocked) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setTheme(mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [themeLocked])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Mirror the view mode and selected day into the URL (FR-DAY-6).
  useEffect(() => {
    const url = new URL(window.location.href)
    if (view === 'detail') url.searchParams.set('view', 'detail')
    else url.searchParams.delete('view')
    if (view === 'detail' && selectedDay !== null) {
      url.searchParams.set('day', String(selectedDay))
    } else {
      url.searchParams.delete('day')
    }
    window.history.replaceState(null, '', url)
  }, [view, selectedDay])

  const selectDay = useCallback((day: number | null) => {
    setSelectedDay(day)
    setSelectedPlaceId(null)
  }, [])

  // Picking a marker on the map follows along to that place's day.
  const selectPlace = useCallback((id: string | null) => {
    setSelectedPlaceId(id)
    if (id && selectedDay !== null) {
      const place = findPlace(id)
      if (place && place.dayNumber !== selectedDay) setSelectedDay(place.dayNumber)
    }
  }, [selectedDay])

  // 0 means "All", 1..N are the days. A functional update so rapid presses accumulate.
  const stepDay = useCallback((delta: number) => {
    setSelectedPlaceId(null)
    setSelectedDay((prev) => {
      const next = Math.min(Math.max((prev ?? 0) + delta, 0), trip.days.length)
      return next === 0 ? null : next
    })
  }, [])

  // Left/right arrows step through days (FR-DAY-5). The tour view has its own keys.
  useEffect(() => {
    if (view !== 'detail') return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return
      if (e.key === 'Escape') { setSelectedPlaceId(null); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); stepDay(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepDay(-1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, stepDay])

  const visibleDays = useMemo(
    () => (selectedDay === null ? trip.days : trip.days.filter((d) => d.dayNumber === selectedDay)),
    [selectedDay],
  )

  const themeButton = (
    <button
      type="button"
      className="iconbtn"
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={() => { setThemeLocked(true); setTheme(theme === 'dark' ? 'light' : 'dark') }}
    >
      {theme === 'dark' ? '☀' : '🌙'}
    </button>
  )

  const viewButton = (
    <button
      type="button"
      className="iconbtn iconbtn--wide"
      onClick={() => setView(view === 'tour' ? 'detail' : 'tour')}
      title={view === 'tour' ? 'Open the day-by-day itinerary' : 'Back to the tour'}
    >
      {view === 'tour' ? 'Itinerary' : 'Tour'}
    </button>
  )

  if (view === 'tour') {
    return (
      <div className="app app--tour">
        <div className="tour__topbar">
          {viewButton}
          {themeButton}
        </div>
        <TourMap theme={theme} />
      </div>
    )
  }

  return (
    <div className={`app${panelOpen ? '' : ' app--panel-closed'}`}>
      <header className="topbar">
        <div className="topbar__title">
          <h1>{trip.title}</h1>
          <p className="topbar__sub">
            {trip.region} · {trip.days.length} days
          </p>
        </div>
        <DayTabs selectedDay={selectedDay} onSelect={selectDay} />
        <div className="topbar__actions">
          {viewButton}
          {themeButton}
          <button
            type="button"
            className="iconbtn iconbtn--panel"
            aria-label={panelOpen ? 'Collapse itinerary panel' : 'Expand itinerary panel'}
            title={panelOpen ? 'Collapse itinerary panel' : 'Expand itinerary panel'}
            onClick={() => setPanelOpen((v) => !v)}
          >
            {panelOpen ? '⇥' : '⇤'}
          </button>
        </div>
      </header>

      <main className="body">
        <MapView
          selectedDay={selectedDay}
          selectedPlaceId={selectedPlaceId}
          hoveredPlaceId={hoveredPlaceId}
          theme={theme}
          onSelectPlace={selectPlace}
          renderPopup={(place) => <PlaceDetail place={place} />}
        />
        <aside className="panel" aria-label="Itinerary">
          <ItineraryPanel
            days={visibleDays}
            selectedPlaceId={selectedPlaceId}
            onSelectPlace={selectPlace}
            onHoverPlace={setHoveredPlaceId}
          />
        </aside>
      </main>
    </div>
  )
}
