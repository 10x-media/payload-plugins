/**
 * How hard `MediaRecorder` is asked to work, and why there are two answers.
 *
 * `instant` is the file itself, what the share link plays back, encoded at a
 * bitrate that looks right in a browser and never gets touched again.
 * `studio` is a master: the input Bunny's own pipeline re-encodes the
 * delivery renditions from, captured heavier than anything that ships because
 * this copy exists to be re-cut later, not to be watched as-is.
 */
export type ClipMode = 'instant' | 'studio'

const VIDEO_BITS_PER_SECOND: Record<ClipMode, number> = {
	instant: 3_000_000,
	studio: 15_000_000,
}

/** What `MediaRecorder` is asked for during capture, for the chosen mode. */
export const videoBitsPerSecond = (mode: ClipMode): number => VIDEO_BITS_PER_SECOND[mode]

/**
 * The microphone-only recording handed to the transcription endpoint.
 *
 * One rate regardless of `ClipMode`, the transcript does not get better at
 * `studio` quality, only bigger. Opus at conversational bitrates keeps even a
 * long meeting comfortably under the endpoint's 25 MB cap; see
 * `bitrate.test.ts` for the arithmetic that keeps this true.
 */
export const AUDIO_BITS_PER_SECOND = 24_000
