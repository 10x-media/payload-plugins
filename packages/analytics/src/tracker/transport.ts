import type { TrackerWindow } from './types'

/**
 * Posts one JSON payload: `sendBeacon` first, since it survives unload, then `fetch` with
 * `keepalive`. Fire-and-forget: a failed send is dropped, never retried.
 */
export const sendPayload = (win: TrackerWindow, url: string, body: unknown): void => {
	const json = JSON.stringify(body)
	const beacon = win.navigator?.sendBeacon
	if (typeof beacon === 'function') {
		try {
			if (beacon.call(win.navigator, url, new Blob([json], { type: 'application/json' }))) {
				return
			}
		} catch {
			// A CSP connect-src violation or a queue overflow: fall through to fetch.
		}
	}
	try {
		void win
			.fetch?.(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: json,
				keepalive: true,
				credentials: 'same-origin',
			})
			?.catch(() => undefined)
	} catch {
		// No transport available (a non-browser host); drop the event.
	}
}
