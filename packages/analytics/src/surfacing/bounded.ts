/** Scopes one instance keeps per-scope state for (lanes, breakers, epochs, registries) at most. */
export const SCOPE_STATE_CAPACITY = 2_000

/**
 * Makes `key` the most recent entry and evicts the least recent past {@link SCOPE_STATE_CAPACITY}
 * (those `keep` holds on to last), so a scope-keyed map never grows with the names asked for.
 */
export const remember = <K, V>(
	map: Map<K, V>,
	[key, value]: readonly [K, V],
	keep?: (value: V) => boolean
): void => {
	map.delete(key)
	map.set(key, value)
	if (map.size <= SCOPE_STATE_CAPACITY) {
		return
	}
	for (const [oldest, held] of map) {
		if (map.size <= SCOPE_STATE_CAPACITY) {
			return
		}
		if (oldest !== key && !keep?.(held)) {
			map.delete(oldest)
		}
	}
	for (const oldest of map.keys()) {
		if (map.size <= SCOPE_STATE_CAPACITY) {
			return
		}
		if (oldest !== key) {
			map.delete(oldest)
		}
	}
}

/** The entry under `key`, made the most recent one. */
export const recall = <K, V>(map: Map<K, V>, key: K): V | undefined => {
	const found = map.get(key)
	if (found !== undefined) {
		map.delete(key)
		map.set(key, found)
	}
	return found
}

/** The entry under `key` as {@link recall} finds it, else one `make` builds, remembered. */
export const recallOr = <K, V>(
	map: Map<K, V>,
	[key, make]: readonly [K, () => V],
	keep?: (value: V) => boolean
): V => {
	const known = recall(map, key)
	if (known !== undefined) {
		return known
	}
	const made = make()
	remember(map, [key, made], keep)
	return made
}
