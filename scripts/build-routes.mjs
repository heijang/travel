#!/usr/bin/env node
/**
 * Turns waypoints into real road geometry and writes it back into the trip JSON.
 *
 *   npm run routes            generate and write the file
 *   npm run routes -- --dry   show what would change, write nothing
 *
 * `waypoints` is the hand-maintained value. `geometry` is this script's output,
 * so don't edit it directly — change the waypoints and re-run.
 *
 * Only car and bus legs are sent to the routing server. Walking, hiking, rail
 * and ferry aren't supported by the public OSRM demo, so their waypoints are
 * used verbatim as the geometry — the more densely you place them, the closer
 * those lines get to reality.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = resolve(HERE, '../src/data/norway-fjords.json')

const OSRM = 'https://router.project-osrm.org/route/v1/driving'
/** Modes sent to the routing server. Everything else uses waypoints as-is. */
const ROUTABLE = new Set(['car', 'bus'])
/** Minimum spacing when thinning geometry (km). Lower is more precise and larger. */
const MIN_STEP_KM = 0.6
/** Delay between requests (ms), to be kind to the public demo server. */
const THROTTLE_MS = 400

const dryRun = process.argv.includes('--dry')

function haversineKm([lng1, lat1], [lng2, lat2]) {
  const R = 6371
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dp = p2 - p1
  const dl = ((lng2 - lng1) * Math.PI) / 180
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Keeps the first and last point, plus any point at least minKm from the last kept one. */
function thin(coords, minKm = MIN_STEP_KM) {
  if (coords.length < 3) return coords.map(round)
  const kept = [coords[0]]
  for (const c of coords.slice(1, -1)) {
    if (haversineKm(kept[kept.length - 1], c) >= minKm) kept.push(c)
  }
  kept.push(coords[coords.length - 1])
  return kept.map(round)
}

const round = ([lng, lat]) => [Number(lng.toFixed(5)), Number(lat.toFixed(5))]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function route(waypoints) {
  const path = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';')
  const res = await fetch(`${OSRM}/${path}?overview=full&geometries=geojson`)
  if (!res.ok) throw new Error(`OSRM ${res.status} ${res.statusText}`)
  const body = await res.json()
  if (body.code !== 'Ok') throw new Error(`OSRM: ${body.code} ${body.message ?? ''}`)
  const r = body.routes[0]
  return {
    geometry: thin(r.geometry.coordinates),
    distanceKm: Number((r.distance / 1000).toFixed(1)),
    durationMin: Math.round(r.duration / 60),
  }
}

/** Processes a single route or leg. `isRoute` marks a whole-day route rather than a leg. */
async function fill(target, label, results, isRoute) {
  if (!target.waypoints?.length) {
    results.push({ label, status: 'no waypoints — skipped' })
    return false
  }
  const before = target.geometry?.length ?? 0

  if (!ROUTABLE.has(target.mode)) {
    target.geometry = target.waypoints.map(round)
    results.push({
      label,
      status: `${target.mode} — not routed, using ${target.waypoints.length} waypoints as-is`,
    })
    return before !== target.geometry.length
  }

  const { geometry, distanceKm, durationMin } = await route(target.waypoints)
  target.geometry = geometry
  // Only a whole-day route carries a distance/duration total. A leg describes
  // itself in `note` instead, since summing mixed modes isn't meaningful.
  if (isRoute) {
    target.distanceKm = distanceKm
    target.durationMin = durationMin
  }
  results.push({
    label,
    status: `${distanceKm} km · ${durationMin} min · geometry ${before} → ${geometry.length} pts`,
  })
  await sleep(THROTTLE_MS)
  return true
}

const trip = JSON.parse(await readFile(DATA, 'utf8'))
const results = []

for (const day of trip.days) {
  const r = day.route
  if (!r) continue
  const legs = r.legs?.length ? r.legs : null
  if (legs) {
    for (const [i, leg] of legs.entries()) {
      await fill(leg, `Day ${day.dayNumber} legs[${i}]`, results, false)
    }
  } else {
    await fill(r, `Day ${day.dayNumber} route`, results, true)
  }
}

const width = Math.max(...results.map((r) => r.label.length))
for (const r of results) console.log(`  ${r.label.padEnd(width)}  ${r.status}`)

if (dryRun) {
  console.log('\n--dry: the file was left untouched.')
} else {
  await writeFile(DATA, `${JSON.stringify(trip, null, 2)}\n`, 'utf8')
  console.log(`\n${DATA} updated`)
}
