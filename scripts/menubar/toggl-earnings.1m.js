#!/usr/bin/env node
// <xbar.title>Toggl monthly earnings</xbar.title>
// <xbar.version>v1.0</xbar.version>
// <xbar.author>eikyo09</xbar.author>
// <xbar.desc>Shows this month's earnings from Toggl Track hours in the menu bar.</xbar.desc>
// <xbar.dependencies>node</xbar.dependencies>
// <xbar.var>string(VAR_TOGGL_API_TOKEN=""): Toggl API token (Toggl Track → Profile settings → API Token).</xbar.var>
// <xbar.var>number(VAR_HOURLY_RATE=70): Hourly rate.</xbar.var>
// <xbar.var>string(VAR_CURRENCY="USD"): ISO currency code.</xbar.var>
// <xbar.var>string(VAR_PROJECT_RATES=""): Optional JSON of per-project rates, e.g. {"Client A": 80}.</xbar.var>
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
 *   3. Set your token and rate, either in the CONFIG block below or in the
 *      plugin's variables (xbar: right-click the plugin → Preferences;
 *      SwiftBar: a toggl-earnings.1m.js.vars.json file next to the plugin).
 *
 * The "1m" in the file name is the refresh interval. Rename to 5m for a
 * slower refresh.
 *
 * If the menu bar shows "node not found", replace the first line with the
 * full path from `which node` (for example #!/opt/homebrew/bin/node).
 */

const CONFIG = {
  token: "", // paste your Toggl API token here, or use VAR_TOGGL_API_TOKEN
  hourlyRate: 70,
  currency: "USD",
  projectRates: {}, // e.g. { "Client A": 80, "(no project)": 0 }
  billableOnly: false,
}

const env = process.env
const token = (
  env.VAR_TOGGL_API_TOKEN ||
  env.TOGGL_API_TOKEN ||
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

const API = "https://api.track.toggl.com/api/v9"
let authScheme = null // remembered after the first successful request

main().catch((err) => {
  console.log("Toggl ✕ | color=red")
  console.log("---")
  console.log(
    `Error: ${String(err.message || err).replace(/\n/g, " ")} | color=red`
  )
  if (!token) {
    console.log(
      "Set VAR_TOGGL_API_TOKEN in the plugin settings, or paste the token into CONFIG.token"
    )
  }
  console.log("Refresh | refresh=true")
  process.exit(0)
})

async function main() {
  if (!token) throw new Error("Toggl API token is not set")
  if (!Number.isFinite(hourlyRate))
    throw new Error("Hourly rate is not a number")

  const now = new Date()
  const me = await get("/me")
  const tz = me.timezone || "UTC"
  const { start, end, label } = monthRange(now, tz)

  const pad = 86400000
  const qs = new URLSearchParams({
    start_date: new Date(start - pad).toISOString().slice(0, 10),
    end_date: new Date(end + pad).toISOString().slice(0, 10),
  })
  const [projects, entries] = await Promise.all([
    get("/me/projects"),
    get(`/me/time_entries?${qs}`),
  ])

  const projectById = new Map((projects || []).map((p) => [p.id, p]))
  const buckets = new Map()
  let running = null
  const clipEnd = Math.min(end, now.getTime())

  for (const e of entries || []) {
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

  // Menu bar line
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
  console.log("Open Toggl Track | href=https://track.toggl.com/timer")
  console.log("Refresh | refresh=true")
}

// Toggl's classic API tokens use HTTP Basic auth as "<token>:api_token".
// Newer prefixed tokens may expect a Bearer header instead, so try both.
async function get(path) {
  const basic = `Basic ${Buffer.from(`${token}:api_token`).toString("base64")}`
  const bearer = `Bearer ${token}`
  const schemes = authScheme ? [authScheme] : [basic, bearer]
  let last = null
  for (const scheme of schemes) {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: scheme, "Content-Type": "application/json" },
    })
    if (res.ok) {
      authScheme = scheme
      return res.json()
    }
    last = res
    if (res.status !== 401 && res.status !== 403) break
  }
  const hint =
    last.status === 401 || last.status === 403
      ? " (token rejected; paste the current token from Toggl Track → Profile settings → API Token)"
      : ""
  throw new Error(`Toggl ${path} returned HTTP ${last.status}${hint}`)
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
    {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }
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
