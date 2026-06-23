'use client'

const CHART_CSS = `
:where(:root) {
	--analytics-chart-1: var(--theme-success-500, #3b82f6);
	--analytics-chart-2: var(--theme-elevation-400);
}
.analytics-chart { position: relative; width: 100%; }
.analytics-chart__svg { display: block; width: 100%; height: 100%; overflow: visible; }
.analytics-chart__grid { stroke: var(--theme-elevation-150); stroke-width: 1; vector-effect: non-scaling-stroke; }
.analytics-chart__area { stroke: none; }
.analytics-chart__line { fill: none; stroke: var(--analytics-chart-1); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.analytics-chart__dot { fill: var(--theme-elevation-0); stroke: var(--analytics-chart-1); stroke-width: 2; }
.analytics-chart__axis { fill: var(--theme-elevation-450); font-size: 0.6875rem; }
.analytics-chart__cursor { stroke: var(--theme-elevation-300); stroke-width: 1; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
.analytics-chart__active { fill: var(--analytics-chart-1); stroke: var(--theme-elevation-0); stroke-width: 2; }
.analytics-chart__tooltip { position: absolute; pointer-events: none; transform: translate(-50%, -120%); background: var(--theme-elevation-0); border: 1px solid var(--theme-elevation-150); border-radius: var(--style-radius-m, 6px); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18); padding: 0.4rem 0.6rem; font-size: 0.75rem; white-space: nowrap; z-index: 10; animation: analytics-fade 0.12s ease-out; }
.analytics-chart__tooltip-label { color: var(--theme-elevation-500); font-weight: 600; margin-bottom: 0.15rem; }
.analytics-chart__tooltip-value { color: var(--theme-elevation-800); font-weight: 700; font-variant-numeric: tabular-nums; }
@keyframes analytics-fade { from { opacity: 0; } to { opacity: 1; } }
.analytics-bars { display: flex; flex-direction: column; gap: 0.35rem; }
.analytics-bars__row { position: relative; display: flex; align-items: center; gap: 0.6rem; }
.analytics-bars__track { position: relative; flex: 1; min-width: 0; height: 1.85rem; border-radius: var(--style-radius-s, 4px); overflow: hidden; }
.analytics-bars__fill { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: color-mix(in srgb, var(--analytics-chart-1) 90%, transparent); transition: filter 0.1s ease; }
.analytics-bars__row:hover .analytics-bars__fill { filter: brightness(1.12); }
.analytics-bars__label { position: relative; padding: 0 0.6rem; color: var(--theme-base-800, #fff); font-size: 0.8125rem; line-height: 1.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.analytics-bars__value { flex: none; font-size: 0.8125rem; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--theme-elevation-800); }
.analytics-bars__empty { color: var(--theme-elevation-400); font-size: 0.8125rem; }
`

/**
 * Single scoped stylesheet for all analytics charts, injected as a `<style>` element so
 * it ships as a JS string (our tsdown build has no CSS pipeline) and behaves identically
 * in dev and when installed from npm. The `--analytics-chart-*` tokens live in `:root`
 * scope so a consuming app can override them.
 */
export function ChartStyles() {
	// biome-ignore lint/security/noDangerouslySetInnerHtml: static build-time CSS constant, no user input
	return <style dangerouslySetInnerHTML={{ __html: CHART_CSS }} />
}
