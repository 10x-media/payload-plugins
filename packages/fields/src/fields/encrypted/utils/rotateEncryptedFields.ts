import type { Payload } from 'payload'
import { getFieldsRegistry } from '../../../plugin/registry'
import { resolveKeys } from '../crypto/keys'
import { isSealed, parseWire } from '../crypto/wire'
import { scanEncryptedFields } from '../scan'
import { ENCRYPTED_CONTEXT_KEY, type EncryptedFieldMarker } from '../types'
import { getAtPath, pageThrough, setAtPath } from './pageThrough'

export interface RotateOptions {
	batchSize?: number
	collections?: string[]
	dryRun?: boolean
}

export interface RotateReport {
	collections: Record<string, { rotated: number; scanned: number }>
}

/**
 * True when any sealed value under `value` carries a keyId other than the
 * active one. Recurses into arrays (hasMany) and into locale maps, which is the
 * `{ [locale]: value }` shape a locale 'all' read hands back.
 */
export const staleIn = (value: unknown, activeId: string): boolean => {
	if (Array.isArray(value)) {
		return value.some((item) => staleIn(item, activeId))
	}
	if (isSealed(value)) {
		return parseWire(value).keyId !== activeId
	}
	if (value && typeof value === 'object') {
		return Object.values(value).some((item) => staleIn(item, activeId))
	}
	return false
}

/**
 * Re-seals every row whose embedded keyId differs from the active key, in
 * paginated batches through the local API. Reads run in 'raw' mode (hooks
 * pass ciphertext through); writes run in 'rotate' mode (the beforeChange
 * hook unseals with the old key, re-seals with the active key, and refreshes
 * the blind index). Localized fields update once per locale. Writes go
 * through payload.update, so versioned collections record a new version per
 * rotated document.
 */
export const rotateEncryptedFields = async (
	payload: Payload,
	options: RotateOptions = {}
): Promise<RotateReport> => {
	const { batchSize = 100, collections, dryRun = false } = options
	const report: RotateReport = { collections: {} }
	const registry = getFieldsRegistry(payload.config)
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

		const ringFor = (marker: EncryptedFieldMarker) =>
			resolveKeys(marker.keys ?? registry?.encrypted?.keys, payload.config.secret)

		for await (const docs of pageThrough({ batchSize, collection: collection.slug, payload })) {
			for (const doc of docs) {
				stats.scanned += 1
				const patch: Record<string, unknown> = {}
				const localePatches = new Map<string, Record<string, unknown>>()
				for (const [path, marker] of markers) {
					const ring = await ringFor(marker)
					const value = getAtPath(doc, path)
					if (value === undefined || !staleIn(value, ring.activeId)) {
						continue
					}
					if (marker.localized && value && typeof value === 'object' && !Array.isArray(value)) {
						for (const locale of localeCodes) {
							const localeValue = (value as Record<string, unknown>)[locale]
							if (localeValue !== undefined && staleIn(localeValue, ring.activeId)) {
								const localePatch = localePatches.get(locale) ?? {}
								setAtPath(localePatch, path, localeValue)
								localePatches.set(locale, localePatch)
							}
						}
					} else {
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
						context: { [ENCRYPTED_CONTEXT_KEY]: 'rotate' },
						data: patch,
						depth: 0,
						id: doc.id as string | number,
						overrideAccess: true,
					})
				}
				for (const [locale, localePatch] of localePatches) {
					await payload.update({
						collection: collection.slug,
						context: { [ENCRYPTED_CONTEXT_KEY]: 'rotate' },
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
