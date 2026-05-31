/** Human duration between two ISO timestamps; undefined when zero, unknown, or invalid. */
export const formatDuration = (start?: string, end?: string): string | undefined => {
	if (!start || !end) {
		return undefined
	}
	const ms = new Date(end).getTime() - new Date(start).getTime()
	if (!Number.isFinite(ms) || ms <= 0) {
		return undefined
	}
	return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}
