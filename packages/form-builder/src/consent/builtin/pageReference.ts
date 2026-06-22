import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineConsentSource } from '../defineConsentSource'
import { resolvePublishedVersionRef } from '../resolvePublishedVersionRef'

type PageReferenceConfig = {
	relationTo?: string
	docId?: string
	urlField?: string
	captureVersion?: boolean
}

export const pageReferenceSource = defineConsentSource<PageReferenceConfig>({
	type: 'pageReference',
	label: keys.consentSourcePageReference,
	config: [
		{ name: 'relationTo', type: 'text', label: labelFor(keys.consentConfigRelationTo) },
		{ name: 'docId', type: 'text', label: labelFor(keys.consentConfigDocId) },
		{
			name: 'urlField',
			type: 'text',
			label: labelFor(keys.consentConfigUrlField),
			defaultValue: 'slug',
		},
		{
			name: 'captureVersion',
			type: 'checkbox',
			label: labelFor(keys.consentConfigCaptureVersion),
		},
	],
	resolve: async ({ config, payload, req, locale }) => {
		const relationTo = String(config.relationTo ?? '')
		const docId = String(config.docId ?? '')
		const urlField = String(config.urlField ?? 'slug')
		const captureVersion = Boolean(config.captureVersion)

		if (!relationTo || !docId) {
			return { links: [] }
		}

		const doc = await payload
			.findByID({
				collection: relationTo as never,
				id: docId,
				depth: 0,
				locale: locale as never,
				req,
			})
			.catch(() => null)

		if (!doc) {
			return { links: [{ label: relationTo, url: '' }] }
		}

		const docRecord = doc as Record<string, unknown>
		const label = String(docRecord.title ?? docRecord[urlField] ?? relationTo)
		const url = String(docRecord[urlField] ?? '')

		if (!captureVersion) {
			return { links: [{ label, url }] }
		}

		const v = await resolvePublishedVersionRef(payload, { collection: relationTo, id: docId })
		return {
			links: [{ label, url }],
			...(v ? { versionRef: v.versionId, versionLabel: v.updatedAt } : {}),
		}
	},
})
