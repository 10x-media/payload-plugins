import {
	APIError,
	type CollectionAfterChangeHook,
	type CollectionAfterDeleteHook,
	type CollectionBeforeChangeHook,
	type CollectionConfig,
	type Config,
	getCurrentDate,
} from 'payload'

import { buildMessageEditor } from '../lexical/editor'
import type { ContentLockPluginOptions, ResolvedOptions } from '../options'
import { statusOf } from '../state/resolve'
import { rebuildSnapshot } from '../state/store'
import { toWindow } from '../state/window'
import { en } from '../translations/en'
import { keys } from '../translations/keys'
import { asTranslate, labelForKey } from '../translations/server'
import { checkWindowChange } from './rules'
import { buildScopeFields } from './scopeFields'

const CLIENT = '@10x-media/content-lock/client'

const stampAndValidate: CollectionBeforeChangeHook = ({ data, operation, originalDoc, req }) => {
	const now = getCurrentDate()
	const stored = operation === 'update' ? originalDoc : undefined
	if (!data.startsAt && !stored?.startsAt) {
		data.startsAt = now.toISOString()
	}
	// An end is always stamped by the server clock, never in the future.
	if (data.endedAt) {
		const requested = Date.parse(String(data.endedAt))
		data.endedAt = new Date(Math.min(requested, now.getTime())).toISOString()
	}
	if (data.endAtTime === false) {
		data.endsAt = null
	}
	if (data.lockEverything === true) {
		data.groups = []
		data.collections = []
		data.globals = []
	}
	const before = stored ? toWindow(stored) : null
	const after = toWindow({ ...stored, ...data })
	const violation = checkWindowChange(before, after, now)
	if (violation) {
		const message = typeof req.t === 'function' ? asTranslate(req.t)(violation) : en[violation]
		throw new APIError(message, 400, null, true)
	}
	return data
}

const syncSnapshotAfterChange: CollectionAfterChangeHook = async ({ doc, req }) => {
	await rebuildSnapshot(req.payload, req)
	return doc
}

const syncSnapshotAfterDelete: CollectionAfterDeleteHook = async ({ doc, req }) => {
	await rebuildSnapshot(req.payload, req)
	return doc
}

/** The lock windows collection. One document is one window. */
export const buildLockCollection = (
	config: Config,
	options: ResolvedOptions,
	raw: Pick<ContentLockPluginOptions, 'collection' | 'individualSelection'>
): CollectionConfig => {
	const collectionOptions = raw.collection
	const scopeFields = buildScopeFields(config, options, raw.individualSelection)
	const collection: CollectionConfig = {
		slug: options.slug,
		labels: {
			singular: labelForKey(keys.collectionSingular),
			plural: labelForKey(keys.collectionPlural),
		},
		access: collectionOptions?.access,
		admin: {
			useAsTitle: 'title',
			defaultColumns: ['title', 'status', 'startsAt', 'endsAt'],
			components: {
				edit: { beforeDocumentControls: [`${CLIENT}#EndNowButton`] },
				views: {
					list: {
						actions: [
							{ path: `${CLIENT}#LockNowButton`, clientProps: { collectionSlug: options.slug } },
						],
					},
				},
			},
		},
		hooks: {
			beforeChange: [stampAndValidate],
			afterChange: [syncSnapshotAfterChange],
			afterDelete: [syncSnapshotAfterDelete],
		},
		fields: [
			{ name: 'title', type: 'text', required: true, label: labelForKey(keys.fieldTitle) },
			{
				name: 'status',
				type: 'select',
				virtual: true,
				label: labelForKey(keys.fieldStatus),
				options: [
					{ value: 'pending', label: labelForKey(keys.statusPending) },
					{ value: 'announced', label: labelForKey(keys.statusAnnounced) },
					{ value: 'active', label: labelForKey(keys.statusActive) },
					{ value: 'ended', label: labelForKey(keys.statusEnded) },
				],
				admin: { readOnly: true, position: 'sidebar' },
				hooks: {
					afterRead: [({ data }) => (data ? statusOf(toWindow(data), getCurrentDate()) : null)],
				},
			},
			{
				type: 'row',
				fields: [
					{
						name: 'announceAt',
						type: 'date',
						label: labelForKey(keys.fieldAnnounceAt),
						admin: {
							date: { pickerAppearance: 'dayAndTime' },
							description: labelForKey(keys.fieldAnnounceAtDescription),
						},
					},
					{
						name: 'startsAt',
						type: 'date',
						label: labelForKey(keys.fieldStartsAt),
						admin: {
							date: { pickerAppearance: 'dayAndTime' },
							description: labelForKey(keys.fieldStartsAtDescription),
						},
					},
				],
			},
			{
				name: 'endAtTime',
				type: 'checkbox',
				defaultValue: false,
				label: labelForKey(keys.fieldEndAtTime),
			},
			{
				name: 'endsAt',
				type: 'date',
				label: labelForKey(keys.fieldEndsAt),
				admin: {
					date: { pickerAppearance: 'dayAndTime' },
					condition: (_data, siblingData) => siblingData?.endAtTime === true,
				},
			},
			...scopeFields,
			{
				name: 'message',
				type: 'richText',
				localized: Boolean(config.localization),
				label: labelForKey(keys.fieldMessage),
				editor: buildMessageEditor(),
				admin: { description: labelForKey(keys.fieldMessageDescription) },
			},
			{
				name: 'endedAt',
				type: 'date',
				label: labelForKey(keys.fieldEndedAt),
				admin: {
					readOnly: true,
					position: 'sidebar',
					date: { pickerAppearance: 'dayAndTime' },
					condition: (data) => Boolean(data?.endedAt),
				},
			},
		],
	}
	return collectionOptions?.overrides ? collectionOptions.overrides(collection) : collection
}
