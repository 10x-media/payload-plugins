'use client'

import { CARD_CHROME, CARD_LABEL } from '../../widgets/cardChrome'

const card = `padding: ${CARD_CHROME.padding}; background: ${CARD_CHROME.background}; border: ${CARD_CHROME.border}; border-radius: ${CARD_CHROME.radius}; box-sizing: border-box;`

const VIEW_CSS = `
.analytics-view { display: flex; flex-direction: column; gap: 1.25rem; padding-bottom: 1.5rem; }
.analytics-view__title { margin: 0; }
.analytics-view__toolbar { display: flex; flex-direction: column; gap: 0.75rem; }
.analytics-view__controls { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.75rem; }
.analytics-view__control { min-width: 10rem; }
.analytics-view__control .field-type { margin-bottom: 0; }
.analytics-view__field-label { display: block; font-size: 0.8125rem; color: var(--theme-elevation-600); margin-bottom: 0.35rem; }
.analytics-view__date { box-sizing: border-box; height: 40px; width: 100%; padding: 0 0.625rem; color: var(--theme-elevation-800); background: var(--theme-input-bg); border: 1px solid var(--theme-elevation-150); border-radius: var(--style-radius-s, 3px); font-family: inherit; font-size: 1rem; transition: border-color 100ms cubic-bezier(0, 0.2, 0.2, 1); }
.analytics-view__date:hover { border-color: var(--theme-elevation-250); }
.analytics-view__date:focus { outline: 0; border-color: var(--theme-elevation-400); }
.analytics-view__toggle { height: 40px; align-items: center; margin: 0; }
.analytics-view__captions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-inline-start: auto; font-size: 0.8125rem; color: var(--theme-elevation-500); }
.analytics-view__chips { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
.analytics-view__chip-remove { display: inline-flex; align-items: center; justify-content: center; margin-inline-start: 0.15rem; padding: 0; background: none; border: 0; color: inherit; cursor: pointer; }
.analytics-view__chip-remove:focus-visible { outline: var(--accessibility-outline, 2px solid var(--theme-elevation-800)); outline-offset: 2px; }
.analytics-view__cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr)); gap: 0.75rem; }
.analytics-view__card { display: flex; flex-direction: column; gap: ${CARD_CHROME.gap}; text-align: start; font: inherit; color: inherit; cursor: pointer; transition: border-color 100ms cubic-bezier(0, 0.2, 0.2, 1); ${card} }
.analytics-view__card:hover { border-color: var(--theme-elevation-250); }
.analytics-view__card[aria-pressed='true'] { border-color: var(--theme-elevation-400); background: var(--theme-elevation-100); }
.analytics-view__card:focus-visible { outline: var(--accessibility-outline, 2px solid var(--theme-elevation-800)); outline-offset: 2px; }
.analytics-view__label { font-size: ${CARD_LABEL.fontSize}; font-weight: ${CARD_LABEL.fontWeight}; letter-spacing: ${CARD_LABEL.letterSpacing}; text-transform: ${CARD_LABEL.textTransform}; color: ${CARD_LABEL.color}; }
.analytics-view__value { font-size: 1.5rem; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; color: var(--theme-elevation-800); }
.analytics-view__panel { display: flex; flex-direction: column; gap: 0.625rem; ${card} }
.analytics-view__error { display: flex; flex-direction: column; align-items: flex-start; gap: 0.5rem; }
.analytics-view__caption { font-size: 0.75rem; color: var(--theme-elevation-400); }
.analytics-view__section[aria-busy='true'] { opacity: 0.6; transition: opacity 100ms ease-out; }
.analytics-view__tabs { display: flex; flex-wrap: wrap; gap: 0.25rem; border-bottom: 1px solid var(--theme-elevation-150); }
.analytics-view__tab { height: 40px; padding: 0 0.75rem; font: inherit; font-size: 0.8125rem; color: var(--theme-elevation-500); background: none; border: 0; border-bottom: 2px solid transparent; cursor: pointer; }
.analytics-view__tab:hover { color: var(--theme-elevation-800); }
.analytics-view__tab[aria-selected='true'] { color: var(--theme-elevation-800); border-bottom-color: var(--theme-elevation-800); }
.analytics-view__tab:focus-visible { outline: var(--accessibility-outline, 2px solid var(--theme-elevation-800)); outline-offset: -2px; }
.analytics-view__bars-head { display: flex; align-items: center; gap: 0.6rem; padding-bottom: 0.35rem; }
.analytics-view__bars-head-dimension { flex: 1; min-width: 0; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--theme-elevation-500); }
.analytics-view__sort { flex: none; padding: 0; font: inherit; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--theme-elevation-500); background: none; border: 0; cursor: pointer; }
.analytics-view__sort:hover, .analytics-view__sort[aria-pressed='true'] { color: var(--theme-elevation-800); }
.analytics-view__sort:focus-visible { outline: var(--accessibility-outline, 2px solid var(--theme-elevation-800)); outline-offset: 2px; }
.analytics-view__sort--metric { min-width: 5.5rem; text-align: end; }
.analytics-view__sort--secondary { min-width: 4.5rem; text-align: end; }
.analytics-view__breakdown .analytics-bars__value { min-width: 5.5rem; text-align: end; }
.analytics-view__breakdown .analytics-bars__secondary { min-width: 4.5rem; text-align: end; }
.analytics-view__table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
.analytics-view__table th { padding: 0.35rem 0.5rem; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--theme-elevation-500); text-align: end; border-bottom: 1px solid var(--theme-elevation-150); }
.analytics-view__table th:first-child, .analytics-view__table td:first-child { text-align: start; }
.analytics-view__table td { padding: 0.4rem 0.5rem; color: var(--theme-elevation-800); font-variant-numeric: tabular-nums; text-align: end; border-bottom: 1px solid var(--theme-elevation-100); }
.analytics-view__scroll { overflow-x: auto; }
.analytics-view__skeleton { height: 4.5rem; border-radius: var(--style-radius-m, 6px); background: var(--theme-elevation-100); animation: analytics-view-pulse 1.2s ease-in-out infinite; }
.analytics-view__skeleton--row { height: 1.85rem; border-radius: var(--style-radius-s, 3px); }
.analytics-view__skeleton--chart { height: 10rem; }
.analytics-view__empty { color: var(--theme-elevation-400); font-size: 0.8125rem; }
.analytics-view__no-sources { display: flex; flex-direction: column; align-items: flex-start; gap: 0.5rem; padding: 2rem 1rem; }
@keyframes analytics-view-pulse { 50% { opacity: 0.45; } }
@media (max-width: 768px) {
	.analytics-view__captions { margin-inline-start: 0; }
	.analytics-view__control { flex: 1 1 100%; }
}
`

/**
 * The analytics view's stylesheet, injected as a `<style>` element: the package has no CSS
 * pipeline (see `ChartStyles`), so the rules ship as a JS string and behave the same in dev
 * and when installed from npm. Every color is a Payload token, so dark mode comes free.
 */
export function ViewStyles() {
	// biome-ignore lint/security/noDangerouslySetInnerHtml: static build-time CSS constant, no user input
	return <style dangerouslySetInnerHTML={{ __html: VIEW_CSS }} />
}
