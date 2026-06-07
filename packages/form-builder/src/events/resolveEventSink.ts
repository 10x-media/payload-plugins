import { noopEventSink } from './noopSink'
import type { FormEventSink } from './types'

/** Resolves the configured event sink, falling back to the no-op sink. Consumed by the submission pipeline in a later phase. */
export const resolveEventSink = (sink: FormEventSink | undefined): FormEventSink =>
	sink ?? noopEventSink
