import type { RealtimeEvent } from '../broker/types'

export function encodeRetry(ms: number): string {
	return `retry: ${ms}\n\n`
}

export function encodeComment(text: string): string {
	return `: ${text}\n\n`
}

export function encodeEvent(event: RealtimeEvent): string {
	const json = JSON.stringify(event)
	const dataLines = json
		.split('\n')
		.map((line) => `data: ${line}`)
		.join('\n')
	return `id: ${event.id}\nevent: ${event.event}\n${dataLines}\n\n`
}
