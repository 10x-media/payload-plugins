/** Where the browser sends the video: a Bunny Stream tus upload, presigned by the server. */
export type BunnyUploadTarget = {
	endpoint: string
	libraryId: string
	signature: string
	expires: number
}

/** A clip the server has created and is waiting for the video of. */
export type ReservedClip = {
	clipId: string
	videoId: string
	upload: BunnyUploadTarget
	/** Proof the caller reserved this clip, sent back on `complete` and `uploadAudio`. */
	token?: string
}

export type ReserveInput<Meta> = {
	source: 'capture' | 'upload'
	durationSeconds: number | undefined
	sizeBytes: number
	meta: Meta
}

/**
 * The server half of a recording, injected into `useClipRecorder` so the same recorder serves the
 * 10x system (same-origin cookie auth) and a client CMS (a plugin endpoint that forwards to 10x
 * with an API key). The video itself never goes through the transport: it goes straight to Bunny.
 */
export type ClipTransport<Meta> = {
	reserve: (input: ReserveInput<Meta>) => Promise<ReservedClip>
	complete: (input: {
		reserved: ReservedClip
		durationSeconds: number | undefined
	}) => Promise<void>
	/** Optional and best-effort: the microphone-only track, for transcription. */
	uploadAudio?: (input: { reserved: ReservedClip; audio: Blob }) => Promise<void>
}
