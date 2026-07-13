const units = ['B', 'KB', 'MB', 'GB'] as const

/**
 * Format a byte count as a human-readable size (1024-based, B/KB/MB/GB) with at most one decimal.
 * Trailing `.0` is dropped: `2621440` -> `'2.5 MB'`, `1024` -> `'1 KB'`, `500` -> `'500 B'`.
 */
export const formatBytes = (n: number): string => {
	if (!Number.isFinite(n) || n <= 0) {
		return '0 B'
	}
	let value = n
	let unit = 0
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024
		unit += 1
	}
	return `${Math.round(value * 10) / 10} ${units[unit]}`
}
