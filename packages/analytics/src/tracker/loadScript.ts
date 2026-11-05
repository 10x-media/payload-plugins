import type { SnippetScript } from './config'
import type { LoadScript, TrackerWindow } from './types'

/** Whether the page already holds the script: the same `src`, or the same inline text. */
export const alreadyPresent = (win: TrackerWindow, script: SnippetScript): boolean => {
	for (const el of win.document.querySelectorAll('script')) {
		if (script.src && el.getAttribute('src') === script.src) {
			return true
		}
		if (script.inline && el.textContent === script.inline) {
			return true
		}
	}
	return false
}

const scriptElement = (
	win: TrackerWindow,
	script: SnippetScript,
	nonce: string | undefined
): HTMLScriptElement => {
	const el = win.document.createElement('script')
	for (const [name, value] of Object.entries(script.attrs ?? {})) {
		el.setAttribute(name, value)
	}
	if (script.type) {
		el.type = script.type
	}
	if (nonce) {
		el.setAttribute('nonce', nonce)
	}
	return el
}

/**
 * The default `loadScript`: injects a snippet script into `<head>`, resolving once it has run. A
 * script already on the page is a no-op, so booting over `AnalyticsScripts`' render loads no copy.
 */
export const createScriptLoader =
	(win: TrackerWindow, nonce?: string): LoadScript =>
	(script) =>
		new Promise((resolve, reject) => {
			const { src, inline } = script
			if (alreadyPresent(win, script)) {
				resolve()
				return
			}
			if (inline) {
				const el = scriptElement(win, script, nonce)
				el.text = inline
				win.document.head.appendChild(el)
				resolve()
				return
			}
			if (!src) {
				resolve()
				return
			}
			const el = scriptElement(win, script, nonce)
			el.async = script.async ?? false
			el.defer = script.defer ?? false
			el.addEventListener('load', () => resolve())
			el.addEventListener('error', () => reject(new Error(`analytics: failed to load ${src}`)))
			el.src = src
			win.document.head.appendChild(el)
		})
