import type { PayloadRequest } from 'payload'

import type { ScanSummary } from '../queue/scan'

type PairEventBase = {
	collection: string
	pairId: string
	docA: string
	docB: string
}

export type DedupeEvent =
	| (PairEventBase & { type: 'pair.dismissed' })
	| (PairEventBase & { type: 'pair.found'; score: number })
	| (PairEventBase & { type: 'pair.reopened' })
	| {
			type: 'merge.applied'
			collection: string
			survivorId: string
			absorbedIds: string[]
	  }
	| {
			type: 'merge.failed'
			collection: string
			survivorId: string
			absorbedIds: string[]
			error: string
	  }
	| { type: 'scan.finished'; collection: string; summary: ScanSummary }

/** Where the plugin reports what it did: a notifier, a webhook, an audit trail. */
export type DedupeEventSink = {
	emit: (event: DedupeEvent, req: PayloadRequest) => Promise<void> | void
}

/**
 * A sink that throws must not undo the work it was told about, so failures are logged
 * and swallowed here.
 */
export const emitEvent = async (
	sink: DedupeEventSink | null,
	event: DedupeEvent,
	req: PayloadRequest
): Promise<void> => {
	if (!sink) return
	try {
		await sink.emit(event, req)
	} catch (error) {
		req.payload.logger.error({ err: error, event: event.type }, '[dedupe] event sink failed')
	}
}
