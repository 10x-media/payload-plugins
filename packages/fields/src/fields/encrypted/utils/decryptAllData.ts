import type { Payload } from 'payload'
import { getFieldsRegistry } from '../../../plugin/registry'
import { resolveKeys } from '../crypto/keys'
import { isSealed, unseal } from '../crypto/wire'
import { scanEncryptedFields } from '../scan'
import { ENCRYPTED_CONTEXT_KEY, type EncryptedFieldMarker } from '../types'
import { getAtPath, pageThrough, setAtPath } from './pageThrough'
import type { RotateOptions, RotateReport } from './rotateEncryptedFields'

interface OpenValueArgs {
	locale?: string
	marker: EncryptedFieldMarker
	slug: string
	value: unknown
}

/**
 * Removal path: unseals every sealed value and stores it as plaintext, with
 * hooks in 'decrypt' mode so nothing re-seals. Non-string plaintexts are
 * stored JSON-stringified (the backing column is text); swapping the field
 * back to its native type afterwards is a schema migration the consumer owns
 * (documented in the removal guide). The decrypt-mode beforeChange hook nulls
 * each blind-index sibling at its own container scope, so this never writes the
 * index by hand (a flat write would mis-scope a nested field's index).
 */
export const decryptAllData = async (
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

		const openValue = async ({ locale, marker, slug, value }: OpenValueArgs): Promise<unknown> => {
			const ring = await resolveKeys(
				marker.keys ?? registry?.encrypted?.keys,
				payload.config.secret
			)
			const base = `${slug}.${marker.fieldName}`
			const candidates = marker.localized
				? [
						...(locale ? [`${base}.${locale}`] : []),
						...localeCodes.map((code) => `${base}.${code}`),
					]
				: [base]
			const openOne = (item: unknown): unknown => {
				if (!isSealed(item)) {
					return item
				}
				const plaintext = unseal(item, ring.dataKeys, candidates)
				return typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext)
			}
			return Array.isArray(value) ? value.map(openOne) : openOne(value)
		}

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
							if (localeValue === undefined || localeValue === null) {
								continue
							}
							const localePatch = localePatches.get(locale) ?? {}
							setAtPath(
								localePatch,
								path,
								await openValue({ locale, marker, slug: collection.slug, value: localeValue })
							)
							localePatches.set(locale, localePatch)
						}
					} else {
						setAtPath(patch, path, await openValue({ marker, slug: collection.slug, value }))
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
						context: { [ENCRYPTED_CONTEXT_KEY]: 'decrypt' },
						data: patch,
						depth: 0,
						id: doc.id as string | number,
						overrideAccess: true,
					})
				}
				for (const [locale, localePatch] of localePatches) {
					await payload.update({
						collection: collection.slug,
						context: { [ENCRYPTED_CONTEXT_KEY]: 'decrypt' },
						data: localePatch,
						depth: 0,
						id: doc.id as string | number,
						locale,
						overrideAccess: true,
					})
				}
			}
		}
	}
	return report
}
