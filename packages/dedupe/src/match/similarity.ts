const jaro = (a: string, b: string): number => {
	if (a === b) return 1
	if (a.length === 0 || b.length === 0) return 0

	const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
	const aMatched = new Array<boolean>(a.length).fill(false)
	const bMatched = new Array<boolean>(b.length).fill(false)

	let matches = 0
	for (let i = 0; i < a.length; i++) {
		const start = Math.max(0, i - window)
		const end = Math.min(i + window + 1, b.length)
		for (let j = start; j < end; j++) {
			if (bMatched[j] || a[i] !== b[j]) continue
			aMatched[i] = true
			bMatched[j] = true
			matches++
			break
		}
	}
	if (matches === 0) return 0

	let transpositions = 0
	let k = 0
	for (let i = 0; i < a.length; i++) {
		if (!aMatched[i]) continue
		while (!bMatched[k]) k++
		if (a[i] !== b[k]) transpositions++
		k++
	}

	const half = transpositions / 2
	return (matches / a.length + matches / b.length + (matches - half) / matches) / 3
}

/** Jaro-Winkler: names diverge at the end far more often than at the start. */
export const jaroWinkler = (a: string, b: string): number => {
	const base = jaro(a, b)
	if (base === 0) return 0
	let prefix = 0
	const maxPrefix = Math.min(4, a.length, b.length)
	while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++
	return base + prefix * 0.1 * (1 - base)
}

/** Characters to insert, delete or replace to turn one text into the other. */
export const editDistance = (a: string, b: string): number => {
	let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
	for (let i = 1; i <= a.length; i++) {
		const current = [i]
		for (let j = 1; j <= b.length; j++) {
			current[j] = Math.min(
				(previous[j] as number) + 1,
				(current[j - 1] as number) + 1,
				(previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1)
			)
		}
		previous = current
	}
	return previous[b.length] as number
}

/**
 * Every token of the shorter side against its best partner on the longer one, averaged.
 * Order-free, so a swapped given and family name still match, and a middle name present
 * on one side only is a completeness difference rather than a mismatch.
 */
export const tokenSimilarity = (a: readonly string[], b: readonly string[]): number => {
	if (a.length === 0 || b.length === 0) return 0
	const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
	const used = new Set<number>()
	let total = 0
	for (const token of shorter) {
		let best = 0
		let bestIndex = -1
		for (const [index, other] of longer.entries()) {
			if (used.has(index)) continue
			const score = jaroWinkler(token, other)
			if (score > best) {
				best = score
				bestIndex = index
			}
		}
		if (bestIndex >= 0) used.add(bestIndex)
		total += best
	}
	return total / shorter.length
}
