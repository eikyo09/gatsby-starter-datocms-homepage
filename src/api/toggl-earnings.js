/**
 * Gatsby Function: GET /api/toggl-earnings[?month=YYYY-MM]
 *
 * Runs server-side so the Toggl API token never reaches the browser and so
 * the browser does not need Toggl to allow cross-origin requests.
 */
const { getMonthlyEarnings } = require("../lib/toggl-earnings")

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET")
    return res.status(405).json({ error: "Method not allowed" })
  }

  res.setHeader("Cache-Control", "no-store")

  try {
    const month =
      typeof req.query.month === "string" ? req.query.month : undefined
    const data = await getMonthlyEarnings({ month })
    return res.status(200).json(data)
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    const status = /TOGGL_API_TOKEN is not set/.test(message)
      ? 503
      : /HTTP 401|HTTP 403/.test(message)
      ? 502
      : /HTTP 402/.test(message)
      ? 429
      : /month must look like|invalid month/.test(message)
      ? 400
      : 500
    return res.status(status).json({ error: message })
  }
}
