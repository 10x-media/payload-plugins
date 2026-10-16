import type { CaptureSnippet, SlotMode, SnippetScript, TrackerSlotConfig } from '../config'
import { slotCountsWithoutConsent } from '../gate'
import { alreadyPresent } from '../loadScript'
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
	/** The slot's mode as an event is sent. */
	mode: () => SlotMode
}): Sink => {
	const { slot, win, loadScript, ingestPath, snippets, mode } = args
	const rendered = (snippet: CaptureSnippet): boolean =>
		snippet.scripts.every((script) => alreadyPresent(win, script))
	/**
	 * Whichever variant the server rendered, so none is injected twice; else the one the slot's mode
	 * asks for as it loads. With no scripts a sink injects nothing and forwards once the global exists.
	 */
	const scripts = (): readonly SnippetScript[] => {
		const full = slot.fullSnippet
		if (!snippets) {
			return []
		}
		if (full === undefined || rendered(slot.snippet)) {
			return slot.snippet.scripts
		}
		return rendered(full) || mode() === 'full' ? full.scripts : slot.snippet.scripts
	}
	const vendor = { slot: slot.slot, win, scripts, loadScript }
	switch (slot.kind) {
		case 'native':
			return createNativeSink({ slot: slot.slot, win, url: ingestPath, mode })
		case 'posthog': {
			const { token } = slot.client
			return createPosthogSink({
				...vendor,
				...(slot.instance === undefined ? {} : { instance: slot.instance }),
				...(typeof token === 'string' ? { token } : {}),
				cookieless: slotCountsWithoutConsent(slot),
			})
		}
		case 'plausible':
			return createPlausibleSink(vendor)
		case 'umami':
			return createUmamiSink(vendor)
		case 'ga4': {
			const { measurementId } = slot.client
			return createGa4Sink({
				...vendor,
				...(typeof measurementId === 'string' ? { measurementId } : {}),
				cookieless: slotCountsWithoutConsent(slot),
			})
		}
	}
}
