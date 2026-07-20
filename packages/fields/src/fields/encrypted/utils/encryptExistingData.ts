import type { Payload } from 'payload'
import { isSealed } from '../crypto/wire'
import { scanEncryptedFields } from '../scan'
import { getAtPath, pageThrough, setAtPath } from './pageThrough'
import type { RotateOptions, RotateReport } from './rotateEncryptedFields'

/** A value still holds plaintext when it (or any hasMany entry) is not sealed. */
const needsSeal = (item: unknown): boolean =>
	item !== null &&
	item !== undefined &&
	!isSealed(item) &&
	(!Array.isArray(item) || item.some((entry) => !isSealed(entry)))

/**
 * Adoption path: seals rows that still hold plaintext (pre-plugin data).
 * Reads run raw; writes run WITHOUT a mode flag so the normal seal hook
 * validates the plaintext and computes the blind index. Legacy rows that
 * fail the field's validation surface as errors naming the document.
 */
export const encryptExistingData = async (
	payload: Payload,
	options: RotateOptions = {}
): Promise<RotateReport> => {
	const { batchSize = 100, collections, dryRun = false } = options
	const report: RotateReport = { collections: {} }
	const localeCodes = payload.config.localization ? payload.config.localization.localeCodes : []

	for (const collection of payload.config.collections) {
		if (collections && !collections.includes(collection.slug)) {
			continue
		}
		const markers = scanEncryptedFields(collection.fields)
		if (markers.size === 0) {
			continue
		}
		const stats = { rotated: 0, scanned: 0 }
		report.collections[collection.slug] = stats

		for await (const docs of pageThrough({ batchSize, collection: collection.slug, payload })) {
			for (const doc of docs) {
				stats.scanned += 1
				const patch: Record<string, unknown> = {}
				const localePatches = new Map<string, Record<string, unknown>>()
				for (const [path, marker] of markers) {
					const value = getAtPath(doc, path)
					if (value === undefined || value === null) {
						continue
					}
					if (marker.localized && typeof value === 'object' && !Array.isArray(value)) {
						for (const locale of localeCodes) {
							const localeValue = (value as Record<string, unknown>)[locale]
							if (needsSeal(localeValue)) {
								const localePatch = localePatches.get(locale) ?? {}
								setAtPath(localePatch, path, localeValue)
								localePatches.set(locale, localePatch)
							}
						}
					} else if (needsSeal(value)) {
						setAtPath(patch, path, value)
					}
				}
				const hasWork = Object.keys(patch).length > 0 || localePatches.size > 0
				if (!hasWork) {
					continue
				}
				stats.rotated += 1
				if (dryRun) {
					continue
				}
				if (Object.keys(patch).length > 0) {
					await payload.update({
						collection: collection.slug,
						data: patch,
						depth: 0,
						id: doc.id as string | number,
						overrideAccess: true,
					})
				}
				for (const [locale, localePatch] of localePatches) {
					await payload.update({
						collection: collection.slug,
						data: localePatch,
						depth: 0,
						id: doc.id as string | number,
						locale: locale as never,
						overrideAccess: true,
					})
				}
			}
		}
	}
	return report
}
