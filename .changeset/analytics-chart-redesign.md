---
"@10x-media/analytics": minor
---

Redesign the dashboard widget charts. The trend widget is now a gradient area chart with a monotone-cubic curve, gridlines, dots, timeframe-aware x-axis labels (weekdays for a 7-day range, dates for a month, months for a year), and a hover tooltip. The breakdown widgets render shadcn-style filled bars with the label inside the bar, the value outside, and a hover tooltip. Series colors use overridable `--analytics-chart-1` / `--analytics-chart-2` tokens (no more disabled-gray). Every widget gains an editable title with its sensible default shown as the field's placeholder. All hand-rolled SVG and CSS with Payload design tokens; no new dependencies.
