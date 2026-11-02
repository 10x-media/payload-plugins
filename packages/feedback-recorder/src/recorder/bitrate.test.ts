import { describe, expect, it } from 'vitest'
import { AUDIO_BITS_PER_SECOND, videoBitsPerSecond } from './bitrate'

describe('the recording bitrate', () => {
	it('encodes an instant clip at delivery quality', () => {
		expect(videoBitsPerSecond('instant')).toBe(3_000_000)
	})

	it('encodes a studio clip at a master quality worth re-cutting', () => {
		expect(videoBitsPerSecond('studio')).toBe(15_000_000)
	})

	it('keeps the audio track small enough to transcribe in one piece', () => {
		// 25 MB is the transcription endpoint's cap. At this rate that is over
		// two hours, so the Ogg-splitting the meeting transcriber needs is not
		// reached for here.
		const secondsUnderTheCap = (25 * 1024 * 1024 * 8) / AUDIO_BITS_PER_SECOND
		expect(secondsUnderTheCap).toBeGreaterThan(2 * 60 * 60)
	})
})
