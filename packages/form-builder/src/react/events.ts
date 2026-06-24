'use client'

import type { FormEvent, FormEventSink } from '../events/types'

/** Distribute `Omit` across the event union so each variant keeps its discriminated extras. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** Emit a lifecycle event through the sink, stamping `formId` + an ISO `at`. */
export const emitFormEvent = (
	sink: FormEventSink,
	formId: string,
	event: DistributiveOmit<FormEvent, 'formId' | 'at'>
): void => {
	void sink.emit({ ...event, formId, at: new Date().toISOString() } as FormEvent)
}
