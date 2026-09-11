import * as React from "react"
import Layout from "../components/layout"
import {
  Container,
  Section,
  Box,
  Flex,
  Heading,
  Kicker,
  Text,
} from "../components/ui"
import * as styles from "../components/earnings-widget.css"

// Toggl free plan: 30 API requests/hour, so poll gently. A running timer
// still ticks every second on the client between polls.
const REFRESH_MS = 10 * 60 * 1000

function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch (e) {
    return `${currency} ${amount.toFixed(2)}`
  }
}

function formatHours(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${String(m).padStart(2, "0")}m`
}

function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

function recentMonths(count) {
  const out = []
  const d = new Date()
  for (let i = 0; i < count; i++) {
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    out.push(`${y}-${String(m).padStart(2, "0")}`)
    d.setMonth(d.getMonth() - 1, 1)
  }
  return out
}

function useEarnings(month) {
  const [state, setState] = React.useState({ status: "loading" })
  const [tick, setTick] = React.useState(0)

  const load = React.useCallback(async () => {
    setState((s) => ({ ...s, status: s.data ? "refreshing" : "loading" }))
    try {
      const qs = month ? `?month=${encodeURIComponent(month)}` : ""
      const res = await fetch(`/api/toggl-earnings${qs}`, {
        headers: { Accept: "application/json" },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body.error || `Request failed with HTTP ${res.status}`)
      }
      setState({ status: "ready", data: body, fetchedAt: Date.now() })
    } catch (err) {
      setState((s) => ({
        status: "error",
        error: err.message,
        data: s.data,
        fetchedAt: s.fetchedAt,
      }))
    }
  }, [month])

  React.useEffect(() => {
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  // Second-by-second tick so a running timer grows on screen.
  React.useEffect(() => {
    if (!state.data || !state.data.running) return undefined
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [state.data])

  return { ...state, reload: load, tick }
}

function withLiveTimer(data, fetchedAt) {
  if (!data || !data.running || !fetchedAt) return data
  const extraSeconds = Math.max(0, Math.floor((Date.now() - fetchedAt) / 1000))
  if (extraSeconds === 0) return data
  const rate = data.running.rate || 0
  const extraEarnings = (extraSeconds / 3600) * rate
  return {
    ...data,
    totalSeconds: data.totalSeconds + extraSeconds,
    earnings: data.earnings + extraEarnings,
    projectedEarnings:
      data.progress > 0
        ? (data.earnings + extraEarnings) / data.progress
        : data.projectedEarnings,
    byProject: data.byProject.map((p) =>
      p.id === data.running.projectId
        ? {
            ...p,
            seconds: p.seconds + extraSeconds,
            earnings: p.earnings + extraEarnings,
          }
        : p
    ),
  }
}

function Stat({ value, label }) {
  return (
    <Box width="fitContent">
      <p className={styles.statValue}>{value}</p>
      <p className={styles.statLabel}>{label}</p>
    </Box>
  )
}

function ErrorNotice({ message }) {
  const missingToken = /TOGGL_API_TOKEN/.test(message || "")
  return (
    <div className={styles.errorBox}>
      <Text variant="bold">Couldn’t load Toggl data</Text>
      <pre className={styles.code}>{message}</pre>
      {missingToken && (
        <Text variant="small">
          Add <code>TOGGL_API_TOKEN</code> and <code>TOGGL_HOURLY_RATE</code> to
          your <code>.env.development</code> file and restart{" "}
          <code>yarn start</code>. See the README section “Toggl earnings
          widget”.
        </Text>
      )}
    </div>
  )
}

export default function EarningsPage() {
  const months = React.useMemo(() => recentMonths(12), [])
  const [month, setMonth] = React.useState(months[0])
  const { status, data: rawData, error, fetchedAt, reload } = useEarnings(month)
  const data = withLiveTimer(rawData, fetchedAt)
  const currency = data ? data.currency : "USD"

  return (
    <Layout
      title="Monthly earnings"
      description="How much you have earned this month from Toggl Track hours"
    >
      <Section>
        <Container>
          <Flex variant="column" gap={4}>
            <div className={styles.toolbar}>
              <Heading as="h1">
                <Kicker>Toggl Track</Kicker>
                {monthLabel(month)}
              </Heading>
              <Box width="fitContent">
                <label>
                  <span className={styles.muted}>Month </span>
                  <select
                    className={styles.select}
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                  >
                    {months.map((m) => (
                      <option key={m} value={m}>
                        {monthLabel(m)}
                      </option>
                    ))}
                  </select>
                </label>
              </Box>
              <button
                type="button"
                className={styles.button}
                onClick={reload}
                disabled={status === "loading" || status === "refreshing"}
              >
                {status === "refreshing" ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            {status === "error" && <ErrorNotice message={error} />}

            {status === "loading" && !data && (
              <Text variant="lead">Loading your hours from Toggl…</Text>
            )}

            {data && (
              <>
                <Box background="primary" padding={4} radius="large">
                  <div className={styles.card}>
                    <div>
                      <p className={styles.statLabel}>Earned so far</p>
                      <p className={styles.heroStat}>
                        {formatMoney(data.earnings, currency)}
                      </p>
                      {data.running && (
                        <Text variant="small">
                          <span className={styles.liveDot} aria-hidden="true" />
                          Timer running on {data.running.projectName}
                          {data.running.description
                            ? ` — ${data.running.description}`
                            : ""}
                        </Text>
                      )}
                    </div>
                    <div className={styles.statGrid}>
                      <Stat
                        value={formatHours(data.totalSeconds)}
                        label="Hours tracked"
                      />
                      <Stat
                        value={formatMoney(data.projectedEarnings, currency)}
                        label="On pace for"
                      />
                      <Stat
                        value={`${Math.round(data.progress * 100)}%`}
                        label="Month elapsed"
                      />
                      <Stat
                        value={String(data.entryCount)}
                        label="Time entries"
                      />
                    </div>
                    <div>
                      <div
                        className={styles.progressTrack}
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(data.progress * 100)}
                        aria-label="Month elapsed"
                      >
                        <div
                          className={styles.progressFill}
                          style={{ width: `${data.progress * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </Box>

                {data.byProject.length > 0 ? (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th className={styles.th}>Project</th>
                          <th className={`${styles.th} ${styles.numeric}`}>
                            Hours
                          </th>
                          <th className={`${styles.th} ${styles.numeric}`}>
                            Rate
                          </th>
                          <th className={`${styles.th} ${styles.numeric}`}>
                            Earned
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.byProject.map((p) => (
                          <tr key={p.id == null ? "none" : p.id}>
                            <td className={styles.td}>
                              <span
                                className={styles.swatch}
                                style={
                                  p.color
                                    ? { backgroundColor: p.color }
                                    : undefined
                                }
                                aria-hidden="true"
                              />
                              {p.name}
                            </td>
                            <td className={`${styles.td} ${styles.numeric}`}>
                              {formatHours(p.seconds)}
                            </td>
                            <td className={`${styles.td} ${styles.numeric}`}>
                              {formatMoney(p.rate, currency)}/h
                            </td>
                            <td className={`${styles.td} ${styles.numeric}`}>
                              {formatMoney(p.earnings, currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Text>
                    No time entries tracked in {monthLabel(month)} yet.
                  </Text>
                )}

                <p className={styles.muted}>
                  {data.user ? `${data.user} · ` : ""}
                  Time zone {data.timeZone} · Default rate{" "}
                  {formatMoney(data.defaultRate, currency)}/h
                  {data.billableOnly ? " · billable entries only" : ""} ·
                  Updated {new Date(data.updatedAt).toLocaleTimeString()}
                </p>
              </>
            )}
          </Flex>
        </Container>
      </Section>
    </Layout>
  )
}
