/**
 * How loud the microphone is, as one number between 0 and 1.
 *
 * Split out and tested because it is the only part of the meter that is not
 * browser plumbing: everything else is an `AnalyserNode` and a draw loop, and
 * a test of those would be a test of the mocks.
 *
 * Root mean square rather than peak. Peak flickers on every consonant and sits
 * at zero between words, which reads as a broken microphone; RMS is what makes
 * a meter look like the voice it is measuring.
 */
export const rmsLevel = (samples: Uint8Array): number => {
	if (samples.length === 0) return 0

	let sumOfSquares = 0
	for (const sample of samples) {
		// `getByteTimeDomainData` centres silence on 128, not 0.
		const centred = (sample - 128) / 128
		sumOfSquares += centred * centred
	}

	const rms = Math.sqrt(sumOfSquares / samples.length)
	return Number.isFinite(rms) ? Math.min(1, rms) : 0
}

/**
 * The bar's width, after making quiet speech visible.
 *
 * A raw RMS of ordinary talking sits around 0.05–0.15, which on a linear bar is
 * a sliver that looks like nothing is being picked up. The curve lifts the
 * bottom of the range without letting anything exceed the top.
 */
export const meterWidth = (level: number): number =>
	Math.round(Math.min(1, Math.max(0, level) ** 0.5) * 100)
