import type { TrackerSlotConfig } from '../config'
import type { LoadScript, Sink, TrackerWindow } from '../types'
import { createGa4Sink } from './ga4'
import { createNativeSink } from './native'
import { createPlausibleSink } from './plausible'
import { createPosthogSink } from './posthog'
import { createUmamiSink } from './umami'

/** The sink delivering one slot's events, by the kind of adapter filling it. */
export const createSink = (args: {
	slot: TrackerSlotConfig
	win: TrackerWindow
	loadScript: LoadScript
	ingestPath: string
	/** False when the host loads the vendor scripts itself. */
	snippets: boolean
}): Sink => {
	const { slot, win, loadScript, ingestPath, snippets } = args
	// With no scripts a vendor sink injects nothing and forwards once the vendor's global exists.
	const scripts = snippets ? slot.snippet.scripts : []
	const vendor = { slot: slot.slot, win, scripts, loadScript }
	switch (slot.kind) {
		case 'native':
			return createNativeSink({ slot: slot.slot, win, url: ingestPath })
		case 'posthog':
			return createPosthogSink({
				...vendor,
				...(slot.instance === undefined ? {} : { instance: slot.instance }),
			})
		case 'plausible':
			return createPlausibleSink(vendor)
		case 'umami':
			return createUmamiSink(vendor)
		case 'ga4': {
			const { measurementId } = slot.client
			return createGa4Sink({
				...vendor,
				...(typeof measurementId === 'string' ? { measurementId } : {}),
			})
		}
	}
}
