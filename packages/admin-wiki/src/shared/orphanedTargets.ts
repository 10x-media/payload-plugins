import { targetKeysForDoc, type WikiTargetDoc } from './targetKeys'

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

type GuideWithTargets = WikiTargetDoc & {
	id: number | string
	slug?: null | string
	title?: null | string
}

/**
 * Diff each guide's stored target keys against the keys that resolve in the
 * walked config. Empty values never produce a key, so a half-typed target is
 * authoring work-in-progress rather than an orphan.
 */
export const collectOrphanedTargets = (
	docs: GuideWithTargets[],
	validTargetKeys: Iterable<string>
): WikiOrphanedGuide[] => {
	const valid = new Set(validTargetKeys)
	const orphans: WikiOrphanedGuide[] = []
	for (const doc of docs) {
		const orphanedKeys = targetKeysForDoc(doc).filter((key) => !valid.has(key))
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
