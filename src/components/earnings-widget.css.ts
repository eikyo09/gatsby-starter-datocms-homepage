import { style, keyframes } from "@vanilla-extract/css"
import { theme } from "../theme.css"
import { media } from "./ui.css"

export const card = style({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[4],
})

export const heroStat = style({
  fontFamily: theme.fonts.mono,
  fontSize: theme.fontSizes[7],
  fontWeight: theme.fontWeights.medium,
  lineHeight: theme.lineHeights.tight,
  letterSpacing: theme.letterSpacings.tight,
  margin: 0,
  fontVariantNumeric: "tabular-nums",
  "@media": {
    [media.small]: {
      fontSize: "88px",
    },
  },
})

export const statGrid = style({
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: theme.space[4],
})

export const statValue = style({
  fontFamily: theme.fonts.mono,
  fontSize: theme.fontSizes[5],
  fontWeight: theme.fontWeights.medium,
  lineHeight: theme.lineHeights.tight,
  margin: 0,
  fontVariantNumeric: "tabular-nums",
})

export const statLabel = style({
  margin: 0,
  marginTop: theme.space[1],
  fontSize: theme.fontSizes[1],
  fontWeight: theme.fontWeights.semibold,
  letterSpacing: theme.letterSpacings.wide,
  textTransform: "uppercase",
  opacity: 0.8,
})

export const progressTrack = style({
  height: "8px",
  width: "100%",
  borderRadius: theme.radii.circle,
  backgroundColor: "rgba(255, 255, 255, 0.25)",
  overflow: "hidden",
})

export const progressFill = style({
  height: "100%",
  borderRadius: theme.radii.circle,
  backgroundColor: theme.colors.background,
  transition: "width 400ms ease",
})

const pulse = keyframes({
  "0%": { opacity: 1 },
  "50%": { opacity: 0.35 },
  "100%": { opacity: 1 },
})

export const liveDot = style({
  display: "inline-block",
  width: "10px",
  height: "10px",
  borderRadius: theme.radii.circle,
  backgroundColor: "currentColor",
  marginRight: theme.space[2],
  animation: `${pulse} 1.6s ease-in-out infinite`,
})

export const table = style({
  width: "100%",
  borderCollapse: "collapse",
  fontSize: theme.fontSizes[2],
})

export const th = style({
  textAlign: "left",
  fontSize: theme.fontSizes[1],
  fontWeight: theme.fontWeights.semibold,
  letterSpacing: theme.letterSpacings.wide,
  textTransform: "uppercase",
  padding: `${theme.space[2]} ${theme.space[2]}`,
  borderBottom: `2px solid ${theme.colors.muted}`,
  color: theme.colors.black,
  opacity: 0.6,
})

export const td = style({
  padding: `${theme.space[3]} ${theme.space[2]}`,
  borderBottom: `1px solid ${theme.colors.muted}`,
  color: theme.colors.black,
  verticalAlign: "middle",
})

export const numeric = style({
  textAlign: "right",
  fontFamily: theme.fonts.mono,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
})

export const swatch = style({
  display: "inline-block",
  width: "12px",
  height: "12px",
  borderRadius: theme.radii.circle,
  marginRight: theme.space[2],
  verticalAlign: "middle",
  backgroundColor: theme.colors.primary,
})

export const tableWrap = style({
  overflowX: "auto",
})

export const toolbar = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: theme.space[3],
})

export const select = style({
  fontFamily: theme.fonts.text,
  fontSize: theme.fontSizes[2],
  padding: `${theme.space[2]} ${theme.space[3]}`,
  borderRadius: theme.radii.button,
  border: `1px solid ${theme.colors.primary}`,
  backgroundColor: theme.colors.background,
  color: theme.colors.primary,
})

export const button = style({
  fontFamily: theme.fonts.text,
  fontSize: theme.fontSizes[2],
  fontWeight: theme.fontWeights.bold,
  padding: `${theme.space[2]} ${theme.space[3]}`,
  borderRadius: theme.radii.button,
  border: "none",
  cursor: "pointer",
  color: theme.colors.background,
  backgroundColor: theme.colors.primary,
  ":hover": { backgroundColor: theme.colors.active },
  ":disabled": { opacity: 0.6, cursor: "default" },
})

export const errorBox = style({
  padding: theme.space[3],
  borderRadius: theme.radii.button,
  border: `1px solid ${theme.colors.primary}`,
  backgroundColor: theme.colors.muted,
  color: theme.colors.black,
})

export const code = style({
  fontFamily: theme.fonts.mono,
  fontSize: theme.fontSizes[1],
  whiteSpace: "pre-wrap",
  margin: 0,
})

export const muted = style({
  opacity: 0.75,
  margin: 0,
  fontSize: theme.fontSizes[1],
})
