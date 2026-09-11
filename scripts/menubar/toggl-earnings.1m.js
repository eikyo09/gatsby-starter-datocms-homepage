#!/usr/bin/env node
// <xbar.title>Toggl monthly earnings</xbar.title>
// <xbar.version>v1.1</xbar.version>
// <xbar.author>eikyo09</xbar.author>
// <xbar.desc>Shows this month's earnings from Toggl Track hours in the menu bar.</xbar.desc>
// <xbar.dependencies>node</xbar.dependencies>
// <xbar.var>string(VAR_TOGGL_API_TOKEN=""): Toggl Track API token (Profile settings → API Token).</xbar.var>
// <xbar.var>number(VAR_HOURLY_RATE=70): Hourly rate.</xbar.var>
// <xbar.var>string(VAR_CURRENCY="USD"): ISO currency code.</xbar.var>
// <xbar.var>string(VAR_PROJECT_RATES=""): Optional JSON of per-project rates, e.g. {"Client A": 80}.</xbar.var>
// <xbar.var>number(VAR_API_INTERVAL_MINUTES=10): Minutes between calls to the Toggl API.</xbar.var>
// <swiftbar.hideAbout>true</swiftbar.hideAbout>
// <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
// <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>

/*
 * macOS menu bar plugin for SwiftBar (https://swiftbar.app) or xbar
 * (https://xbarapp.com). Self-contained: no npm install needed.
 *
 * Install:
 *   1. Install SwiftBar (brew install --cask swiftbar) or xbar.
 *   2. Copy this file into the plugin folder and make it executable:
 *        chmod +x toggl-earnings.1m.js
 *   3. Set your token: copy it from Toggl Track → Profile settings → API
 *      Token, then run `pbpaste > ~/.toggl-token`. (Alternatives: the CONFIG
 *      block below, or the VAR_ plugin variables in xbar preferences or a
 *      SwiftBar toggl-earnings.1m.js.vars.json file.)
 *
 * Toggl's free plan allows 30 API requests per hour, so the script runs
 * every minute but only calls Toggl every API_INTERVAL_MINUTES (default 10).
 * Between calls it recomputes from a local cache, so a running timer still
 * ticks up every minute. That is about 6 requests per hour, plus 2 per day
 * for your profile and project list.
 *
 * If the menu bar shows "node not found", replace the first line with the
 * full path from `which node` (for example #!/opt/homebrew/bin/node).
 */

const fs = require("fs")
const os = require("os")
const path = require("path")

const CONFIG = {
  token: "", // paste your Toggl API token here, or use ~/.toggl-token
  hourlyRate: 70,
  currency: "USD",
  projectRates: {}, // e.g. { "Client A": 80, "(no project)": 0 }
  billableOnly: false,
  apiIntervalMinutes: 10,
}

const env = process.env
const token = (
  env.VAR_TOGGL_API_TOKEN ||
  env.TOGGL_API_TOKEN ||
  readTokenFile() ||
  CONFIG.token
).trim()
const hourlyRate = Number(
  env.VAR_HOURLY_RATE || env.TOGGL_HOURLY_RATE || CONFIG.hourlyRate
)
const currency = (
  env.VAR_CURRENCY ||
  env.TOGGL_CURRENCY ||
  CONFIG.currency
).toUpperCase()
const projectRates =
  parseRates(env.VAR_PROJECT_RATES || env.TOGGL_PROJECT_RATES) ||
  CONFIG.projectRates
const apiIntervalMs =
  Number(env.VAR_API_INTERVAL_MINUTES || CONFIG.apiIntervalMinutes) * 60000

const API = "https://api.track.toggl.com/api/v9"
const CACHE_FILE = path.join(
  os.homedir(),
  ".cache",
  "toggl-earnings",
  "cache.json"
)
const META_TTL_MS = 24 * 3600 * 1000 // profile + project list
const QUOTA_BACKOFF_MS = 15 * 60000 // wait after an HTTP 402
const force = process.argv.includes("--force")

main().catch((err) => {
  console.log("Toggl ✕ | color=red")
  console.log("---")
  console.log(
    `Error: ${String(err.message || err).replace(/\n/g, " ")} | color=red`
  )
  if (!token) {
    console.log(
      "Copy the API token from Toggl Track → Profile settings, then run: pbpaste > ~/.toggl-token"
    )
  }
  console.log(
    `Retry now | bash="${process.argv[1]}" param1=--force terminal=false refresh=true`
  )
  process.exit(0)
})

async function main() {
  if (!token) throw new Error("Toggl API token is not set")
  if (!Number.isFinite(hourlyRate))
    throw new Error("Hourly rate is not a number")

  const now = new Date()
  const cache = readCache()
  let note = null

  const monthNow = monthRange(now, cache.timezone || "UTC").label
  const needMeta =
    !cache.timezone ||
    !Array.isArray(cache.projects) ||
    now - (cache.metaAt || 0) > META_TTL_MS
  const needEntries =
    force ||
    !Array.isArray(cache.entries) ||
    cache.entriesMonth !== monthNow ||
    now - (cache.entriesAt || 0) > apiIntervalMs
  const quotaBlocked =
    !force && cache.quotaHitAt && now - cache.quotaHitAt < QUOTA_BACKOFF_MS

  if ((needMeta || needEntries) && !quotaBlocked) {
    try {
      if (needMeta) {
        const me = await get("/me")
        cache.timezone = me.timezone || "UTC"
        cache.projects = await get("/me/projects")
        cache.metaAt = now.getTime()
      }
      const range = monthRange(now, cache.timezone)
      if (needEntries || cache.entriesMonth !== range.label) {
        const pad = 86400000
        const qs = new URLSearchParams({
          start_date: new Date(range.start - pad).toISOString().slice(0, 10),
          end_date: new Date(range.end + pad).toISOString().slice(0, 10),
        })
        cache.entries = await get(`/me/time_entries?${qs}`)
        cache.entriesAt = now.getTime()
        cache.entriesMonth = range.label
      }
      delete cache.quotaHitAt
    } catch (err) {
      if (err.status === 402) {
        cache.quotaHitAt = now.getTime()
        note = "Toggl API hourly quota reached; showing cached data"
      } else if (Array.isArray(cache.entries)) {
        note = `Toggl error (${err.message}); showing cached data`
      } else {
        throw err
      }
    }
    writeCache(cache)
  } else if (quotaBlocked) {
    const wait = Math.ceil(
      (QUOTA_BACKOFF_MS - (now - cache.quotaHitAt)) / 60000
    )
    note = `Toggl API quota reached; next try in ${wait} min`
  }

  if (!Array.isArray(cache.entries)) throw new Error("No data from Toggl yet")

  render(cache, now, note)
}

function render(cache, now, note) {
  const { start, end, label } = monthRange(now, cache.timezone || "UTC")
  const projectById = new Map((cache.projects || []).map((p) => [p.id, p]))
  const buckets = new Map()
  let running = null
  const clipEnd = Math.min(end, now.getTime())

  for (const e of cache.entries) {
    if (e.server_deleted_at) continue
    if (CONFIG.billableOnly && !e.billable) continue
    const s = Date.parse(e.start)
    const isRunning = !e.stop || e.duration < 0
    const st = isRunning ? now.getTime() : Date.parse(e.stop)
    const seconds = Math.max(
      0,
      Math.round((Math.min(st, clipEnd) - Math.max(s, start)) / 1000)
    )
    if (seconds === 0 && !isRunning) continue
    const p = projectById.get(e.project_id)
    const key = p ? p.id : "none"
    if (!buckets.has(key)) {
      buckets.set(key, {
        name: p ? p.name : "(no project)",
        rate: rateFor(p),
        seconds: 0,
      })
    }
    const b = buckets.get(key)
    b.seconds += seconds
    if (isRunning && s < end) {
      running = { name: b.name, description: e.description || "" }
    }
  }

  const rows = [...buckets.values()].sort((a, b) => b.seconds - a.seconds)
  const totalSeconds = rows.reduce((n, r) => n + r.seconds, 0)
  const earnings = rows.reduce((n, r) => n + (r.seconds / 3600) * r.rate, 0)
  const progress =
    Math.min(Math.max(now.getTime() - start, 0), end - start) / (end - start)
  const projected = progress > 0 ? earnings / progress : 0

  const dot = running ? "● " : ""
  console.log(`${dot}${money(earnings)} | font=Menlo`)
  console.log("---")
  console.log(`${label} · ${hours(totalSeconds)} tracked`)
  console.log(
    `On pace for ${money(projected)} (${Math.round(
      progress * 100
    )}% of month elapsed)`
  )
  if (running) {
    console.log(
      `Timer running: ${running.name}${
        running.description ? " — " + running.description : ""
      } | color=green`
    )
  }
  if (rows.length) {
    console.log("---")
    for (const r of rows) {
      console.log(
        `${r.name}  ${hours(r.seconds)}  ${money(
          (r.seconds / 3600) * r.rate
        )} | font=Menlo size=12`
      )
    }
  }
  console.log("---")
  if (note) console.log(`${note} | color=orange`)
  const age = Math.round((now.getTime() - (cache.entriesAt || 0)) / 60000)
  console.log(
    `Toggl data from ${age <= 0 ? "just now" : age + " min ago"} | size=11`
  )
  console.log("Open Toggl Track | href=https://track.toggl.com/timer")
  console.log(
    `Refresh from Toggl now | bash="${process.argv[1]}" param1=--force terminal=false refresh=true`
  )
}

async function get(p) {
  const auth = `Basic ${Buffer.from(`${token}:api_token`).toString("base64")}`
  const res = await fetch(`${API}${p}`, {
    headers: { Authorization: auth, "Content-Type": "application/json" },
  })
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? " (token rejected; copy the API Token from Toggl Track → Profile settings)"
        : res.status === 402
        ? " (hourly API quota reached)"
        : ""
    const err = new Error(`Toggl ${p} returned HTTP ${res.status}${hint}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) || {}
  } catch {
    return {}
  }
}

function writeCache(cache) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache))
  } catch {
    // read-only home? keep going with in-memory data
  }
}

function rateFor(project) {
  const rates = projectRates || {}
  const lower = {}
  for (const [k, v] of Object.entries(rates))
    lower[String(k).toLowerCase()] = Number(v)
  if (project) {
    if (lower[String(project.id)] != null) return lower[String(project.id)]
    const byName = lower[String(project.name || "").toLowerCase()]
    if (byName != null) return byName
  } else if (lower["(no project)"] != null) {
    return lower["(no project)"]
  }
  return hourlyRate
}

// Optional: keep the token in ~/.toggl-token (one line) so the plugin file
// can be replaced without losing it. Copy the token, then run:
//   pbpaste > ~/.toggl-token
function readTokenFile() {
  try {
    return fs
      .readFileSync(path.join(os.homedir(), ".toggl-token"), "utf8")
      .trim()
  } catch {
    return ""
  }
}

function parseRates(raw) {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function offsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(date)
  const name = (parts.find((p) => p.type === "timeZoneName") || {}).value || ""
  const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(name)
  if (!m) return 0
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0))
}

function zonedMonthStart(year, month, timeZone) {
  let guess = Date.UTC(year, month - 1, 1)
  for (let i = 0; i < 2; i++) {
    guess =
      Date.UTC(year, month - 1, 1) -
      offsetMinutes(new Date(guess), timeZone) * 60000
  }
  return guess
}

function monthRange(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
  }).formatToParts(now)
  const year = Number(parts.find((p) => p.type === "year").value)
  const month = Number(parts.find((p) => p.type === "month").value)
  const start = zonedMonthStart(year, month, timeZone)
  const end =
    month === 12
      ? zonedMonthStart(year + 1, 1, timeZone)
      : zonedMonthStart(year, month + 1, timeZone)
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric", timeZone: "UTC" }
  )
  return { start, end, label }
}

function money(n) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `${currency} ${n.toFixed(0)}`
  }
}

function hours(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${String(m).padStart(2, "0")}m`
}
