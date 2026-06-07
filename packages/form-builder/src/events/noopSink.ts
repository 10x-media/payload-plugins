import type { FormEventSink } from './types'

export const noopEventSink: FormEventSink = {
	emit: () => Promise.resolve(),
}
