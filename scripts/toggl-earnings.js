#!/usr/bin/env node
/**
 * Prints this month's Toggl earnings in the terminal.
 *
 *   yarn earnings            # current month
 *   yarn earnings 2026-08    # a specific month
 *   yarn earnings --json     # raw JSON
 *
 * Reads TOGGL_* variables from .env / .env.development (same as the site).
 */
require("dotenv").config()
require("dotenv").config({
  path: `.env.${process.env.NODE_ENV || "development"}`,
})

const { getMonthlyEarnings } = require("../src/lib/toggl-earnings")

const args = process.argv.slice(2)
const json = args.includes("--json")
const month = args.find((a) => /^\d{4}-\d{1,2}$/.test(a))

function fmtMoney(n, currency) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(n)
  } catch {
    return `${currency} ${n.toFixed(2)}`
  }
}

function fmtHours(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${String(m).padStart(2, "0")}m`
}

getMonthlyEarnings({ month })
  .then((data) => {
    if (json) {
      console.log(JSON.stringify(data, null, 2))
      return
    }
    const c = data.currency
    console.log("")
    console.log(`  Toggl earnings for ${data.month}  (${data.timeZone})`)
    console.log(`  ${"─".repeat(56)}`)
    console.log(`  Earned so far:   ${fmtMoney(data.earnings, c)}`)
    console.log(
      `  Hours tracked:   ${fmtHours(data.totalSeconds)}  (${
        data.entryCount
      } entries)`
    )
    console.log(`  Month progress:  ${Math.round(data.progress * 100)}%`)
    console.log(`  On pace for:     ${fmtMoney(data.projectedEarnings, c)}`)
    if (data.running) {
      console.log(
        `  Running now:     ${data.running.projectName}${
          data.running.description ? ` — ${data.running.description}` : ""
        }`
      )
    }
    if (data.byProject.length) {
      console.log("")
      const nameWidth = Math.max(
        12,
        ...data.byProject.map((p) => p.name.length)
      )
      console.log(
        `  ${"Project".padEnd(nameWidth)}  ${"Hours".padStart(
          9
        )}  ${"Rate".padStart(8)}  ${"Earned".padStart(12)}`
      )
      for (const p of data.byProject) {
        console.log(
          `  ${p.name.padEnd(nameWidth)}  ${fmtHours(p.seconds).padStart(
            9
          )}  ${String(p.rate).padStart(8)}  ${fmtMoney(p.earnings, c).padStart(
            12
          )}`
        )
      }
    }
    console.log("")
  })
  .catch((err) => {
    console.error(`\n  Error: ${err.message}\n`)
    process.exit(1)
  })
