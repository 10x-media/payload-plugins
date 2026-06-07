import { noopEventSink } from './noopSink'
import type { FormEventSink } from './types'

export const resolveEventSink = (sink: FormEventSink | undefined): FormEventSink =>
	sink ?? noopEventSink
