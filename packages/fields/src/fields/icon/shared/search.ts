import type { IconMeta } from '../../../types'

type IndexEntry = { icon: IconMeta; name: string; nameTokens: string[]; tags: string[] }
export type IconSearchIndex = IndexEntry[]

export const buildIconSearchIndex = (icons: IconMeta[]): IconSearchIndex =>
	icons.map((icon) => ({
		icon,
		name: icon.name.toLowerCase(),
		nameTokens: icon.name.toLowerCase().split('-'),
		tags: icon.tags.map((tag) => tag.toLowerCase()),
	}))

const scoreToken = (entry: IndexEntry, token: string): number => {
	if (entry.name === token) return 100
	if (entry.name.startsWith(token)) return 80
	if (entry.nameTokens.some((part) => part.startsWith(token))) return 60
	if (entry.name.includes(token)) return 40
	if (entry.tags.some((tag) => tag === token)) return 30
	if (entry.tags.some((tag) => tag.startsWith(token))) return 20
	if (entry.tags.some((tag) => tag.includes(token))) return 10
	return 0
}

/**
 * Every whitespace-separated token must match name or tags; score is the sum.
 * Ties break by name length first: within a score band the query covers more of
 * a short name than a long one, so `arrow-up` outranks `arrow-autofit-content`.
 * Length ties then break alphabetically to keep results stable.
 */
export const searchIcons = (index: IconSearchIndex, query: string): IconMeta[] => {
	const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
	if (tokens.length === 0) return index.map((entry) => entry.icon)
	const scored: { icon: IconMeta; score: number }[] = []
	for (const entry of index) {
		let total = 0
		let matchedAll = true
		for (const token of tokens) {
			const score = scoreToken(entry, token)
			if (score === 0) {
				matchedAll = false
				break
			}
			total += score
		}
		if (matchedAll) scored.push({ icon: entry.icon, score: total })
	}
	return scored
		.sort(
			(a, b) =>
				b.score - a.score ||
				a.icon.name.length - b.icon.name.length ||
				a.icon.name.localeCompare(b.icon.name)
		)
		.map((entry) => entry.icon)
}
