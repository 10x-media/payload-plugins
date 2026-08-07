import { targetKeyForRow, type WikiTargetRow } from './targetKeys'

/** One guide whose stored targets no longer resolve against the config. */
export type WikiOrphanedGuide = {
	id: number | string
	orphanedKeys: string[]
	slug: null | string
	title: null | string
}

export type WikiOrphansResponse = {
	orphans: WikiOrphanedGuide[]
}

type GuideWithTargets = {
	id: number | string
	slug?: null | string
	targets?: null | WikiTargetRow[]
	title?: null | string
}

/**
 * Diff each guide's stored target keys against the keys that resolve in the
 * walked config. Incomplete rows (no key) are ignored; they are authoring
 * work-in-progress, not orphans.
 */
export const collectOrphanedTargets = (
	docs: GuideWithTargets[],
	validTargetKeys: Iterable<string>
): WikiOrphanedGuide[] => {
	const valid = new Set(validTargetKeys)
	const orphans: WikiOrphanedGuide[] = []
	for (const doc of docs) {
		const orphanedKeys: string[] = []
		for (const row of doc.targets ?? []) {
			const key = targetKeyForRow(row)
			if (key && !valid.has(key)) {
				orphanedKeys.push(key)
			}
		}
		if (orphanedKeys.length > 0) {
			orphans.push({
				id: doc.id,
				orphanedKeys,
				slug: doc.slug ?? null,
				title: doc.title ?? null,
			})
		}
	}
	return orphans
}
