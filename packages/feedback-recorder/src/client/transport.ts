import type { ClipTransport, ReservedClip } from '../recorder/transport'

/** What the person says about a recording, sent with the reservation. */
export type SubmissionMeta = {
	kind: 'bug' | 'question' | 'idea' | 'feedback'
	title?: string
	note?: string
	context: Record<string, unknown>
}

export class EndpointError extends Error {
	readonly status: number
	readonly code: string | null

	constructor(input: { status: number; code: string | null }) {
		super(
			`Feedback recorder endpoint answered ${input.status}${input.code ? ` (${input.code})` : ''}`
		)
		this.status = input.status
		this.code = input.code
	}
}

const failure = async (response: Response): Promise<EndpointError> => {
	const body = (await response.json().catch(() => null)) as { error?: unknown } | null
	return new EndpointError({
		status: response.status,
		code: typeof body?.error === 'string' ? body.error : null,
	})
}

const isReserved = (value: unknown): value is ReservedClip => {
	if (!value || typeof value !== 'object') return false
	const candidate = value as Partial<ReservedClip>
	return (
		typeof candidate.clipId === 'string' &&
		typeof candidate.videoId === 'string' &&
		typeof candidate.upload?.endpoint === 'string' &&
		typeof candidate.upload?.signature === 'string'
	)
}

/**
 * The recorder's server half in a client CMS: this plugin's own endpoints, same-origin with the
 * admin's session cookie. They forward to the 10x system with the site's key, which never reaches
 * the browser. Only the video goes elsewhere, straight to Bunny.
 */
export const createPluginTransport = (
	endpoint: string,
	fetchImpl: typeof fetch = (...args) => fetch(...args)
): ClipTransport<SubmissionMeta> => ({
	reserve: async ({ source, durationSeconds, sizeBytes, meta }) => {
		const response = await fetchImpl(`${endpoint}/clips`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ source, durationSeconds, sizeBytes, ...meta }),
		})
		if (!response.ok) throw await failure(response)
		const body: unknown = await response.json()
		if (!isReserved(body)) throw new EndpointError({ status: 502, code: 'invalidReservation' })
		return body
	},
	complete: async ({ reserved, durationSeconds }) => {
		const response = await fetchImpl(
			`${endpoint}/clips/${encodeURIComponent(reserved.clipId)}/complete`,
			{
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(durationSeconds === undefined ? {} : { durationSeconds }),
			}
		)
		if (!response.ok) throw await failure(response)
	},
	uploadAudio: async ({ reserved, audio }) => {
		const response = await fetchImpl(
			`${endpoint}/clips/${encodeURIComponent(reserved.clipId)}/audio`,
			{
				method: 'PUT',
				credentials: 'include',
				headers: { 'Content-Type': audio.type || 'audio/webm' },
				body: audio,
			}
		)
		if (!response.ok) throw await failure(response)
	},
})

/** One of the signed-in user's recordings, as the 10x system reports it. */
export type MyRecording = {
	id: string
	title: string
	kind: string | null
	status: 'uploading' | 'processing' | 'ready' | 'failed'
	triage: 'new' | 'seen' | 'inProgress' | 'done' | null
	createdAt: string
	durationSeconds: number | null
}

export const fetchMyRecordings = async (
	endpoint: string,
	fetchImpl: typeof fetch = (...args) => fetch(...args)
): Promise<MyRecording[]> => {
	const response = await fetchImpl(`${endpoint}/clips`, { credentials: 'include' })
	if (!response.ok) throw await failure(response)
	const body = (await response.json()) as { docs?: unknown }
	return Array.isArray(body.docs) ? (body.docs as MyRecording[]) : []
}
