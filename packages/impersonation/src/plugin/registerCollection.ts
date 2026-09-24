import type { CollectionConfig, CollectionSlug, Config } from 'payload'

import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import type { ResolvedOptions } from '../types'
import { ADMIN_GROUP } from './constants'

const deny = () => false

export const buildRecordsCollection = ({
	authSlugs,
	options,
}: {
	authSlugs: CollectionSlug[]
	options: ResolvedOptions
}): CollectionConfig => {
	const relationTo: CollectionSlug[] = authSlugs.length > 0 ? authSlugs : ['users']

	return {
		slug: options.collectionSlug,
		access: {
			create: deny,
			delete: deny,
			read: options.access.readRecords,
			update: deny,
		},
		admin: {
			defaultColumns: ['target', 'impersonator', 'startedAt', 'endedAt', 'endedBy'],
			group: ADMIN_GROUP,
			hidden: !options.ui.sessionsCollection,
			useAsTitle: 'targetEmail',
			...(options.ui.recordAction
				? {
						components: {
							edit: {
								beforeDocumentControls: ['@10x-media/impersonation/client#EndSessionMenuItem'],
							},
						},
					}
				: {}),
		},
		fields: [
			{
				name: 'impersonator',
				type: 'relationship',
				label: labelForKey(keys.fieldImpersonator),
				relationTo,
				required: true,
			},
			{
				name: 'target',
				type: 'relationship',
				label: labelForKey(keys.fieldTarget),
				relationTo,
				required: true,
			},
			{ name: 'impersonatorEmail', type: 'text', index: true },
			{ name: 'targetEmail', type: 'text', index: true },
			{
				name: 'mode',
				type: 'select',
				label: labelForKey(keys.fieldMode),
				options: [
					{ label: 'swap', value: 'swap' },
					{ label: 'parallel', value: 'parallel' },
				],
				required: true,
			},
			{ name: 'targetSid', type: 'text', index: true, required: true },
			{ name: 'impersonatorSid', type: 'text', index: true, required: true },
			{ name: 'impersonatorTenantCookie', type: 'text' },
			{
				name: 'startedAt',
				type: 'date',
				label: labelForKey(keys.fieldStartedAt),
				required: true,
			},
			{ name: 'endedAt', type: 'date', index: true, label: labelForKey(keys.fieldEndedAt) },
			{
				name: 'endedBy',
				type: 'select',
				label: labelForKey(keys.fieldEndedBy),
				options: [
					{ label: 'exit', value: 'exit' },
					{ label: 'logout', value: 'logout' },
					{ label: 'terminated', value: 'terminated' },
					{ label: 'expired', value: 'expired' },
					{ label: 'impersonatorGone', value: 'impersonatorGone' },
					{ label: 'targetGone', value: 'targetGone' },
					{ label: 'failed', value: 'failed' },
				],
			},
			{
				name: 'reason',
				maxLength: 500,
				type: 'text',
				label: labelForKey(keys.fieldReason),
			},
			{ name: 'ip', type: 'text' },
			{ name: 'userAgent', type: 'text' },
			{ name: 'impersonatorLocale', type: 'text' },
			{ name: 'absoluteExpiresAt', type: 'date' },
			{ name: 'targetLocked', type: 'checkbox' },
		],
		indexes: [{ fields: ['targetSid', 'endedAt'] }, { fields: ['impersonatorSid', 'endedAt'] }],
		labels: {
			plural: labelForKey(keys.collectionPlural),
			singular: labelForKey(keys.collectionSingular),
		},
		timestamps: true,
	}
}

export const registerCollection = (config: Config, options: ResolvedOptions): void => {
	const authSlugs = (config.collections ?? [])
		.filter((collection) => Boolean(collection.auth))
		.map(({ slug }) => slug as CollectionSlug)
	config.collections = [
		...(config.collections ?? []),
		buildRecordsCollection({ authSlugs, options }),
	]
}
