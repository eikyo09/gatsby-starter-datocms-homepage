/**
 * Toggl Track → monthly earnings.
 *
 * Shared by the Gatsby Function (src/api/toggl-earnings.js) and the CLI
 * (scripts/toggl-earnings.js). Plain CommonJS with no dependencies so it can
 * run in Node directly.
 *
 * Toggl Track API v9 (works on the free plan):
 *   GET https://api.track.toggl.com/api/v9/me
 *   GET https://api.track.toggl.com/api/v9/me/projects
 *   GET https://api.track.toggl.com/api/v9/me/time_entries?start_date=..&end_date=..
 * Auth is HTTP Basic with `<api_token>:api_token`.
 * A running entry has `stop: null` and a negative `duration`.
 */

const TOGGL_API = "https://api.track.toggl.com/api/v9"

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

function parseProjectRates(raw) {
  if (!raw) return {}
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
    const out = {}
    for (const [key, value] of Object.entries(parsed || {})) {
      const rate = Number(value)
      if (Number.isFinite(rate)) out[String(key).toLowerCase()] = rate
    }
    return out
  } catch (err) {
    throw new Error(
      `TOGGL_PROJECT_RATES must be JSON like {"Client A": 80, "12345": 60}: ${err.message}`
    )
  }
}

function readConfig(env = process.env) {
  const token = (env.TOGGL_API_TOKEN || "").trim()
  const defaultRate = Number(env.TOGGL_HOURLY_RATE || 0)
  return {
    token,
    defaultRate: Number.isFinite(defaultRate) ? defaultRate : 0,
    currency: (env.TOGGL_CURRENCY || "USD").trim().toUpperCase(),
    projectRates: parseProjectRates(env.TOGGL_PROJECT_RATES),
    billableOnly: /^(1|true|yes)$/i.test(env.TOGGL_BILLABLE_ONLY || ""),
    timeZone: (env.TOGGL_TIMEZONE || "").trim() || null,
  }
}

/* ------------------------------------------------------------------ */
/* Time zone helpers (no deps; relies on Intl in Node >= 14)           */
/* ------------------------------------------------------------------ */

function offsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(date)
  const name = (parts.find((p) => p.type === "timeZoneName") || {}).value
  const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(name || "")
  if (!m) return 0
  const sign = m[1] === "-" ? -1 : 1
  return sign * (Number(m[2]) * 60 + Number(m[3] || 0))
}

/** UTC instant of local midnight on the 1st of (year, month) in timeZone. */
function zonedMonthStart(year, month, timeZone) {
  // month is 1-based. Start from the UTC guess and correct with the offset
  // twice so DST transitions near midnight still resolve correctly.
  let guess = Date.UTC(year, month - 1, 1)
  for (let i = 0; i < 2; i++) {
    const off = offsetMinutes(new Date(guess), timeZone)
    guess = Date.UTC(year, month - 1, 1) - off * 60000
  }
  return new Date(guess)
}

function parseMonth(input, now, timeZone) {
  if (input) {
    const m = /^(\d{4})-(\d{1,2})$/.exec(String(input).trim())
    if (!m) throw new Error(`month must look like YYYY-MM, got "${input}"`)
    const month = Number(m[2])
    if (month < 1 || month > 12) throw new Error(`invalid month "${input}"`)
    return { year: Number(m[1]), month }
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
  }).formatToParts(now)
  const get = (t) => Number(parts.find((p) => p.type === t).value)
  return { year: get("year"), month: get("month") }
}

function monthRange({ month, now, timeZone }) {
  const { year, month: mon } = parseMonth(month, now, timeZone)
  const start = zonedMonthStart(year, mon, timeZone)
  const end =
    mon === 12
      ? zonedMonthStart(year + 1, 1, timeZone)
      : zonedMonthStart(year, mon + 1, timeZone)
  return {
    label: `${year}-${String(mon).padStart(2, "0")}`,
    year,
    month: mon,
    start,
    end,
  }
}

/* ------------------------------------------------------------------ */
/* Toggl HTTP                                                          */
/* ------------------------------------------------------------------ */

async function togglGet(path, token, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available; use Node 18+")
  }
  const auth = Buffer.from(`${token}:api_token`).toString("base64")
  const res = await fetchImpl(`${TOGGL_API}${path}`, {
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    const hint =
      res.status === 401 || res.status === 403
        ? " (check TOGGL_API_TOKEN: Toggl Track → Profile → API Token)"
        : res.status === 402
        ? " (Toggl hourly API quota reached; the free plan allows 30 requests per hour)"
        : res.status === 429
        ? " (Toggl rate limit; try again in a minute)"
        : ""
    throw new Error(`Toggl ${path} failed: HTTP ${res.status}${hint} ${body}`)
  }
  return res.json()
}

function toDateParam(d) {
  return d.toISOString().slice(0, 10)
}

/**
 * Fetches time entries that overlap [start, end). Toggl filters on entry
 * start and treats end_date as exclusive, so we pad both sides by a day and
 * clip precisely on our side.
 */
async function fetchTimeEntries({ token, start, end, fetchImpl }) {
  const pad = 24 * 3600 * 1000
  const qs = new URLSearchParams({
    start_date: toDateParam(new Date(start.getTime() - pad)),
    end_date: toDateParam(new Date(end.getTime() + pad)),
  })
  const entries = await togglGet(`/me/time_entries?${qs}`, token, fetchImpl)
  return Array.isArray(entries) ? entries : []
}

/* ------------------------------------------------------------------ */
/* Pure calculation                                                    */
/* ------------------------------------------------------------------ */

function rateForProject(project, config) {
  const { projectRates, defaultRate } = config
  if (project) {
    const byId = projectRates[String(project.id).toLowerCase()]
    if (byId != null) return byId
    const byName = projectRates[String(project.name || "").toLowerCase()]
    if (byName != null) return byName
  } else if (projectRates["(no project)"] != null) {
    return projectRates["(no project)"]
  }
  return defaultRate
}

/**
 * @param {object} args
 * @param {Array} args.entries  raw Toggl time entries
 * @param {Array} args.projects raw Toggl projects
 * @param {Date}  args.start    inclusive month start (UTC instant)
 * @param {Date}  args.end      exclusive month end (UTC instant)
 * @param {Date}  args.now
 * @param {object} args.config  from readConfig()
 */
function summarize({ entries, projects, start, end, now, config }) {
  const projectById = new Map()
  for (const p of projects || []) projectById.set(p.id, p)

  const startMs = start.getTime()
  const endMs = end.getTime()
  const nowMs = now.getTime()
  const clipEnd = Math.min(endMs, nowMs)

  const byProject = new Map()
  let running = null
  let entryCount = 0

  for (const entry of entries || []) {
    if (entry.server_deleted_at) continue
    if (config.billableOnly && !entry.billable) continue

    const s = Date.parse(entry.start)
    if (!Number.isFinite(s)) continue
    const isRunning = !entry.stop || entry.duration < 0
    const e = isRunning ? nowMs : Date.parse(entry.stop)
    if (!Number.isFinite(e)) continue

    const from = Math.max(s, startMs)
    const to = Math.min(e, clipEnd)
    const seconds = Math.max(0, Math.round((to - from) / 1000))
    if (seconds === 0 && !(isRunning && s >= startMs && s < endMs)) continue

    const project = projectById.get(entry.project_id) || null
    const key = project ? project.id : "none"
    if (!byProject.has(key)) {
      byProject.set(key, {
        id: project ? project.id : null,
        name: project ? project.name : "(no project)",
        color: project ? project.color : null,
        rate: rateForProject(project, config),
        seconds: 0,
        entries: 0,
      })
    }
    const bucket = byProject.get(key)
    bucket.seconds += seconds
    bucket.entries += 1
    entryCount += 1

    if (isRunning && s < endMs && nowMs >= startMs && nowMs < endMs) {
      running = {
        id: entry.id,
        description: entry.description || "",
        projectId: bucket.id,
        projectName: bucket.name,
        rate: bucket.rate,
        start: entry.start,
      }
    }
  }

  const rows = [...byProject.values()]
    .map((row) => ({
      ...row,
      hours: round(row.seconds / 3600, 2),
      earnings: round((row.seconds / 3600) * row.rate, 2),
    }))
    .sort((a, b) => b.seconds - a.seconds)

  const totalSeconds = rows.reduce((n, r) => n + r.seconds, 0)
  const earnings = round(
    rows.reduce((n, r) => n + (r.seconds / 3600) * r.rate, 0),
    2
  )

  // Pace: how far through the month are we, and where does this land?
  const monthMs = endMs - startMs
  const elapsedMs = Math.min(Math.max(nowMs - startMs, 0), monthMs)
  const progress = monthMs > 0 ? elapsedMs / monthMs : 1
  const projected = progress > 0 ? round(earnings / progress, 2) : 0

  return {
    range: { start: start.toISOString(), end: end.toISOString() },
    currency: config.currency,
    defaultRate: config.defaultRate,
    billableOnly: config.billableOnly,
    entryCount,
    totalSeconds,
    totalHours: round(totalSeconds / 3600, 2),
    earnings,
    progress: round(progress, 4),
    projectedEarnings: projected,
    running,
    byProject: rows,
  }
}

function round(n, places) {
  const f = 10 ** places
  return Math.round(n * f) / f
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

/*
 * Toggl's free plan allows 30 API requests per hour per user (sliding
 * window; HTTP 402 when exceeded). Profile and project list change rarely,
 * so they are memoised for a day; time entries for a few minutes.
 */
const memo = new Map()
const DEFAULT_TTL = { meta: 24 * 3600 * 1000, entries: 5 * 60 * 1000 }

async function memoised(key, ttlMs, now, fn) {
  const hit = memo.get(key)
  if (hit && now.getTime() - hit.at < ttlMs) return hit.value
  const value = await fn()
  memo.set(key, { at: now.getTime(), value })
  return value
}

function clearCache() {
  memo.clear()
}

async function getMonthlyEarnings({
  env = process.env,
  month,
  now = new Date(),
  fetchImpl,
  ttl = DEFAULT_TTL,
} = {}) {
  const config = readConfig(env)
  if (!config.token) {
    throw new Error(
      "TOGGL_API_TOKEN is not set. Find it in Toggl Track → Profile settings → API Token."
    )
  }
  const k = (name) => `${config.token}:${name}`

  const me = await memoised(k("me"), ttl.meta, now, () =>
    togglGet("/me", config.token, fetchImpl)
  )
  const timeZone = config.timeZone || me.timezone || "UTC"
  const range = monthRange({ month, now, timeZone })

  const [projects, entries] = await Promise.all([
    memoised(k("projects"), ttl.meta, now, () =>
      togglGet("/me/projects", config.token, fetchImpl)
    ),
    memoised(k(`entries:${range.label}`), ttl.entries, now, () =>
      fetchTimeEntries({
        token: config.token,
        start: range.start,
        end: range.end,
        fetchImpl,
      })
    ),
  ])

  const summary = summarize({
    entries,
    projects: Array.isArray(projects) ? projects : [],
    start: range.start,
    end: range.end,
    now,
    config,
  })

  return {
    month: range.label,
    timeZone,
    user: me.fullname || me.email || null,
    updatedAt: now.toISOString(),
    ...summary,
  }
}

module.exports = {
  TOGGL_API,
  readConfig,
  parseProjectRates,
  monthRange,
  zonedMonthStart,
  offsetMinutes,
  summarize,
  rateForProject,
  getMonthlyEarnings,
  clearCache,
}
