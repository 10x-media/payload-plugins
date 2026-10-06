import type { SnippetScript } from '../core/capture'
import type { LoadScript, TrackerWindow } from './types'

const alreadyPresent = (win: TrackerWindow, script: SnippetScript): boolean => {
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

/**
 * The default `loadScript` seam: injects a snippet script into `<head>`, resolving once it
 * has run. A script the page already carries is a no-op, which is what makes the RSC path
 * safe: `AnalyticsScripts` renders the same snippets server-side, and the sink booting over
 * them must not load a second copy. Inline scripts resolve as soon as they are appended,
 * since appending runs them.
 */
export const createScriptLoader =
	(win: TrackerWindow, nonce?: string): LoadScript =>
	(script) =>
		new Promise((resolve, reject) => {
			if ((!script.src && !script.inline) || alreadyPresent(win, script)) {
				resolve()
				return
			}
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
			if (script.inline) {
				el.text = script.inline
				win.document.head.appendChild(el)
				resolve()
				return
			}
			el.async = script.async ?? false
			el.defer = script.defer ?? false
			el.addEventListener('load', () => resolve())
			el.addEventListener('error', () =>
				reject(new Error(`analytics: failed to load ${script.src}`))
			)
			el.src = script.src as string
			win.document.head.appendChild(el)
		})
