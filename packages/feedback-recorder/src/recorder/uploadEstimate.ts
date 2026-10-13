/**
 * How long a dropped file will take to leave the browser.
 *
 * Nobody here knows the caller's actual upload bandwidth, that lives on
 * their router, not in this codebase, so this assumes a single figure, 10
 * Mbps, an ordinary home uplink, rather than pretending to measure one. A 2
 * GB export comes out to a little under half an hour at that rate, which is
 * the number worth learning before the wait starts, not a precise one. See
 * `ClipDropzone.client.tsx`, which labels it as an estimate rather than a
 * promise.
 */
export const ASSUMED_UPLINK_BITS_PER_SECOND = 10_000_000

const BITS_PER_BYTE = 8
const SECONDS_PER_MINUTE = 60

/**
 * Minutes, rounded up so a small file never reads as an instant upload, a
 * near-zero estimate still shows `1`, not `0`. A size that is not a real,
 * positive number (zero, negative, `NaN`, `Infinity`) has nothing to
 * estimate, so it comes back as `0` rather than a nonsense duration.
 */
export const estimateUploadMinutes = (
	sizeBytes: number,
	uplinkBitsPerSecond: number = ASSUMED_UPLINK_BITS_PER_SECOND
): number => {
	if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return 0
	const seconds = (sizeBytes * BITS_PER_BYTE) / uplinkBitsPerSecond
	return Math.max(1, Math.ceil(seconds / SECONDS_PER_MINUTE))
}
