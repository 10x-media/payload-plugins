import { currentTime } from '../core/clock'
import { canonicalJson } from '../core/values'
import type { CacheEntry, CacheStore, ReadRecipe } from '../surfacing/cacheStore'

interface HeldEntry extends CacheEntry {
	recipe?: ReadRecipe
}

export interface MemoryCacheStore extends CacheStore {
	/** Every entry held, expired ones included until a sweep deletes them. */
	readonly entries: ReadonlyMap<string, HeldEntry>
}

/** A cache store held in one process's memory, for tests. */
export const memoryCacheStore = (options: { now?: () => number } = {}): MemoryCacheStore => {
	const now = options.now ?? currentTime
	const entries = new Map<string, HeldEntry>()
	return {
		entries,
		async get(key) {
			const held = entries.get(key)
			if (!held || held.staleUntil <= now()) {
				return null
			}
			const { recipe: _recipe, ...entry } = held
			return entry
		},
		async set(key, value, opts) {
			const at = now()
			const expiresAt = at + opts.ttlSeconds * 1000
			const before = entries.get(key)
			const recipe = opts.recipe ?? before?.recipe
			entries.set(key, {
				value,
				fetchedAt: at,
				expiresAt,
				staleUntil: expiresAt + opts.staleSeconds * 1000,
				readAt: opts.recipe ? at : (before?.readAt ?? null),
				...(recipe ? { recipe } : {}),
			})
		},
		async touch(key, at, recipe) {
			const held = entries.get(key)
			if (held) {
				entries.set(key, { ...held, readAt: at.getTime(), ...(recipe ? { recipe } : {}) })
			}
		},
		async sweep(at, batch) {
			const expired = [...entries]
				.filter(([, held]) => held.staleUntil < at.getTime())
				.slice(0, batch)
			for (const [key] of expired) {
				entries.delete(key)
			}
			return expired.length
		},
		async recentRecipes(since, limit) {
			const read = [...entries.values()]
				.filter((held) => held.recipe && (held.readAt ?? -1) >= since.getTime())
				.sort((a, b) => (b.readAt ?? 0) - (a.readAt ?? 0))
			const seen = new Set<string>()
			const recipes: ReadRecipe[] = []
			for (const held of read) {
				const id = canonicalJson(held.recipe)
				if (held.recipe && !seen.has(id) && recipes.length < limit) {
					seen.add(id)
					recipes.push(held.recipe)
				}
			}
			return recipes
		},
	}
}
