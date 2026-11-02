/** `75` → `1:15`; hours only when there are any. */
export const formatDuration = (totalSeconds: number): string => {
	const safe = Math.max(0, Math.floor(totalSeconds))
	const hours = Math.floor(safe / 3600)
	const minutes = Math.floor((safe % 3600) / 60)
	const seconds = String(safe % 60).padStart(2, '0')
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
		: `${minutes}:${seconds}`
}

/** A file name for a saved copy: the date, and the container the browser recorded in. */
export const copyFileName = (blob: Blob, now: Date = new Date()): string => {
	const stamp = now.toISOString().slice(0, 16).replace('T', '-').replace(':', '')
	const extension = blob.type.includes('mp4') ? 'mp4' : 'webm'
	return `recording-${stamp}.${extension}`
}
