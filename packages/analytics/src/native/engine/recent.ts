/** Scopes one per-scope memory of the engine (last good zones, site hostnames) holds at most. */
export const MAX_REMEMBERED_SCOPES = 10_000

/**
 * Sets `key` as the most recent entry of `map`, then forgets the least recent past
 * {@link MAX_REMEMBERED_SCOPES}, handing each key it drops to `forgotten`.
 */
export const keepRecent = <K, V>(
	map: Map<K, V>,
	[key, value]: readonly [K, V],
	forgotten?: (key: K) => void
): void => {
	map.delete(key)
	map.set(key, value)
	for (const oldest of map.keys()) {
		if (map.size <= MAX_REMEMBERED_SCOPES) {
			return
		}
		map.delete(oldest)
		forgotten?.(oldest)
	}
}
