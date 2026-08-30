#!/usr/bin/env node
/**
 * Downloads a photo for every place that can supply one, stores it under
 * `public/photos/`, and points the place's `imageUrl` at it.
 *
 * Two sources:
 *   - a booking link  → the listing's Open Graph preview image
 *   - `wikipedia`     → the article's lead image from Wikimedia Commons,
 *                       together with its author and licence for `imageCredit`
 *
 *   npm run images            fetch and write
 *   npm run images -- --dry   report what would change, write nothing
 *   npm run images -- --force re-download even if the file already exists
 *
 * Why download instead of hotlinking: booking-CDN URLs carry a per-photo id that
 * changes when the host edits the listing, and nothing guarantees either source
 * keeps serving cross-origin. A local copy means the picture always shows. The
 * cost is that it goes stale — re-run to refresh.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = resolve(HERE, '../src/data/norway-fjords.json')
const OUT_DIR = resolve(HERE, '../public/photos')
/** Path the app uses. Relative, so it survives being deployed under a subpath. */
const PUBLIC_PREFIX = 'photos'
/** Width to request from Commons. Big enough for a card, small enough to ship. */
const COMMONS_WIDTH = 960

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36'
/**
 * Wikimedia's API policy asks callers to identify themselves rather than
 * impersonate a browser, and rate-limits anonymous bursts (429).
 */
const WIKI_UA = 'travel-map/0.1 (personal itinerary project; local use)'
/** Gap between Wikimedia API calls (ms). */
const THROTTLE_MS = 350
/** How many times to retry a rate-limited Wikimedia call. */
const MAX_RETRIES = 5

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const dryRun = process.argv.includes('--dry')
const force = process.argv.includes('--force')

/** Pulls the og:image URL out of a listing page. */
function findOgImage(html) {
  const meta =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
  if (!meta) return null
  // Meta content is HTML-escaped, so &amp; has to come back to & or the query breaks.
  return meta[1].replace(/&amp;/g, '&')
}

async function fetchImageUrl(pageUrl) {
  const res = await fetch(pageUrl, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`listing page ${res.status} ${res.statusText}`)
  const url = findOgImage(await res.text())
  if (!url) throw new Error('no og:image on the page')
  return url
}

/**
 * Wikimedia call with backoff. Two requests per place in a tight loop trips a
 * 429, but the limit is short-lived and the response says how long to wait, so
 * honour Retry-After rather than giving up on the place.
 */
const api = async (url, attempt = 0) => {
  await sleep(THROTTLE_MS)
  const res = await fetch(url, { headers: { 'User-Agent': WIKI_UA } })
  if (res.status === 429 && attempt < MAX_RETRIES) {
    const wait = (Number(res.headers.get('retry-after')) || 2) * 1000
    console.log(`    rate limited, waiting ${wait / 1000}s…`)
    await sleep(wait + 250)
    return api(url, attempt + 1)
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

const stripTags = (html) => (html ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

/**
 * Lead image of a Wikipedia article, with attribution.
 *
 * Commons images are licensed (usually CC BY-SA), so the author and licence
 * have to travel with the picture. Anything without both is skipped rather
 * than shipped uncredited.
 */
async function fromWikipedia(title) {
  const page = await api(
    'https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&piprop=name' +
      `&titles=${encodeURIComponent(title)}`,
  )
  const file = Object.values(page.query.pages)[0]?.pageimage
  if (!file) throw new Error(`no lead image on "${title}"`)

  const info = await api(
    'https://commons.wikimedia.org/w/api.php?action=query&format=json' +
      `&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=${COMMONS_WIDTH}` +
      `&titles=${encodeURIComponent(`File:${file}`)}`,
  )
  const ii = Object.values(info.query.pages)[0]?.imageinfo?.[0]
  if (!ii) throw new Error(`no file info for ${file}`)

  const meta = ii.extmetadata ?? {}
  const artist = stripTags(meta.Artist?.value)
  const licence = stripTags(meta.LicenseShortName?.value)
  if (!artist || !licence) throw new Error(`missing attribution for ${file}`)

  return {
    url: ii.thumburl ?? ii.url,
    credit: `${artist} · ${licence} · Wikimedia Commons`,
  }
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' })
  if (!res.ok) throw new Error(`image ${res.status} ${res.statusText}`)
  const type = res.headers.get('content-type') ?? ''
  if (!type.startsWith('image/')) throw new Error(`not an image (${type})`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length < 1024) throw new Error(`suspiciously small (${bytes.length} bytes)`)
  if (!dryRun) await writeFile(dest, bytes)
  return { bytes: bytes.length, type }
}

const trip = JSON.parse(await readFile(DATA, 'utf8'))
if (!dryRun) await mkdir(OUT_DIR, { recursive: true })

const results = []
let changed = false

for (const day of trip.days) {
  for (const place of day.places) {
    const link = place.links?.find((l) => l.type === 'booking')
    const source = link ? 'booking' : place.wikipedia ? 'wikipedia' : null
    if (!source) continue

    const file = `${place.id}.jpg`
    const dest = join(OUT_DIR, file)
    const rel = `${PUBLIC_PREFIX}/${file}`

    if (existsSync(dest) && !force) {
      if (place.imageUrl !== rel) { place.imageUrl = rel; changed = true }
      results.push({ id: place.id, status: `already downloaded — kept (use --force to refresh)` })
      continue
    }

    try {
      let imageUrl
      let credit = null
      if (source === 'booking') {
        imageUrl = await fetchImageUrl(link.url)
      } else {
        const found = await fromWikipedia(place.wikipedia)
        imageUrl = found.url
        credit = found.credit
      }
      const { bytes } = await download(imageUrl, dest)
      if (place.imageUrl !== rel || place.imageCredit !== (credit ?? undefined)) changed = true
      place.imageUrl = rel
      if (credit) place.imageCredit = credit
      else delete place.imageCredit
      results.push({
        id: place.id,
        status: `${source} · ${(bytes / 1024).toFixed(0)} KB → ${rel}${credit ? ` · ${credit}` : ''}`,
      })
    } catch (err) {
      // A failed fetch must not wipe an image that is already in place.
      results.push({ id: place.id, status: `FAILED: ${err.message}` })
    }
  }
}

const width = Math.max(...results.map((r) => r.id.length))
for (const r of results) console.log(`  ${r.id.padEnd(width)}  ${r.status}`)

if (dryRun) {
  console.log('\n--dry: nothing was written.')
} else if (changed) {
  await writeFile(DATA, `${JSON.stringify(trip, null, 2)}\n`, 'utf8')
  console.log(`\n${DATA} updated`)
} else {
  console.log('\nNo change to the trip data.')
}
