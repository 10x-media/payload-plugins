import { describe, expect, it } from 'vitest'
import { meterWidth, rmsLevel } from './micLevel'

const silence = (length = 128): Uint8Array => new Uint8Array(length).fill(128)

const tone = (amplitude: number, length = 128): Uint8Array =>
	Uint8Array.from({ length }, (_, index) =>
		Math.round(128 + Math.sin((index / length) * Math.PI * 2) * amplitude * 127)
	)

describe('the microphone level', () => {
	it('reads silence as nothing, not as a small something', () => {
		expect(rmsLevel(silence())).toBe(0)
	})

	it('rises with amplitude', () => {
		expect(rmsLevel(tone(0.5))).toBeGreaterThan(rmsLevel(tone(0.1)))
	})

	it('never exceeds one, however loud', () => {
		expect(rmsLevel(tone(1))).toBeLessThanOrEqual(1)
	})

	it('returns nothing for an empty buffer rather than dividing by zero', () => {
		expect(rmsLevel(new Uint8Array(0))).toBe(0)
	})
})

describe('the meter width', () => {
	it('is empty at silence and full at the top', () => {
		expect(meterWidth(0)).toBe(0)
		expect(meterWidth(1)).toBe(100)
	})

	it('makes ordinary speech visible rather than a sliver', () => {
		// Talking sits around 0.1 RMS; on a linear bar that is 10% and reads as
		// a dead microphone. The curve is the whole reason this function exists.
		expect(meterWidth(0.1)).toBeGreaterThan(25)
	})

	it('clamps rather than propagating nonsense', () => {
		expect(meterWidth(-1)).toBe(0)
		expect(meterWidth(5)).toBe(100)
	})
})
