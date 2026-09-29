import {
	APIError,
	type CollectionAfterChangeHook,
	type CollectionAfterDeleteHook,
	type CollectionBeforeChangeHook,
	type CollectionBeforeOperationHook,
	type CollectionConfig,
	type Config,
	type FieldHook,
	getCurrentDate,
} from 'payload'

import { buildMessageEditor } from '../lexical/editor'
import type { ContentLockPluginOptions, ResolvedOptions } from '../options'
import { statusOf } from '../state/resolve'
import { readWindows, rebuildSnapshot } from '../state/store'
import { toWindow } from '../state/window'
import { en } from '../translations/en'
import { keys } from '../translations/keys'
import { asTranslate, labelForKey } from '../translations/server'
import { updateUnlessEnded } from './access'
import { checkWindowChange } from './rules'
import { buildScopeFields } from './scopeFields'

const CLIENT = '@10x-media/content-lock/client'
const RSC = '@10x-media/content-lock/rsc'

/**
 * A write that is not an explicit draft publishes. Payload would otherwise
 * default `_status` to draft, and a lock created through the Local API or REST
 * would silently lock nothing.
 */
const publishUnlessDraft: CollectionBeforeOperationHook = ({ args, operation }) => {
	if ((operation === 'create' || operation === 'update') && !args.draft && args.data) {
		const data = args.data as { _status?: string }
		data._status ??= 'published'
	}
	return args
}

/**
 * Normalizes a window and enforces the editing rules. Drafts skip both the
 * start stamp and the rules: they lock nothing, so they may be incomplete, and
 * an empty start means "when published".
 */
const stampAndValidate: CollectionBeforeChangeHook = ({ data, operation, originalDoc, req }) => {
	const now = getCurrentDate()
	const stored = operation === 'update' ? originalDoc : undefined
	const draft = data._status === 'draft'
	if (!draft && !data.startsAt && !stored?.startsAt) {
		data.startsAt = now.toISOString()
	}
	// An end is always stamped by the server clock, never in the future.
	if (data.endedAt) {
		const requested = Date.parse(String(data.endedAt))
		data.endedAt = new Date(Math.min(requested, now.getTime())).toISOString()
	}
	if (data.announce === false) {
		data.announceAt = null
	}
	if (data.endAtTime === false) {
		data.endsAt = null
	}
	if (data.lockEverything === true) {
		data.groups = []
		data.collections = []
		data.globals = []
	}
	if (draft) {
		return data
	}
	const merged = { ...stored, ...data }
	const before = stored ? toWindow(stored) : null
	const after = toWindow(merged)
	const violation =
		merged.announce === true && !merged.announceAt
			? keys.errorAnnounceAtRequired
			: checkWindowChange(before, after, now)
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

/**
 * The live stage of a window. A window the runtime knows is judged by its
 * published values, so a pending draft of an active lock still reads active;
 * an unpublished one reads draft.
 */
const liveStatus: FieldHook = async ({ data, req }) => {
	if (!data) {
		return null
	}
	const now = getCurrentDate()
	const live = (await readWindows(req.payload).catch(() => [])).find(
		(window) => window.id === String(data.id)
	)
	if (live) {
		return statusOf(live, now)
	}
	return data._status === 'draft' ? 'draft' : statusOf(toWindow(data), now)
}

/** The lock windows collection. One document is one window. */
export const buildLockCollection = (
	config: Config,
	options: ResolvedOptions,
	raw: Pick<ContentLockPluginOptions, 'collection' | 'editor' | 'individualSelection' | 'timezone'>
): CollectionConfig => {
	const collectionOptions = raw.collection
	const timezone =
		raw.timezone === false ? undefined : raw.timezone === undefined ? true : raw.timezone
	const scopeFields = buildScopeFields(config, options, raw.individualSelection)
	const editor = buildMessageEditor({
		groups: options.groups.map(({ key, label, collections, globals }) => ({
			key,
			label,
			collections,
			globals,
		})),
		features: raw.editor?.features,
	})
	const collection: CollectionConfig = {
		slug: options.slug,
		labels: {
			singular: labelForKey(keys.collectionSingular),
			plural: labelForKey(keys.collectionPlural),
		},
		access: {
			...collectionOptions?.access,
			update: updateUnlessEnded(collectionOptions?.access?.update),
		},
		admin: {
			useAsTitle: 'title',
			defaultColumns: ['title', 'status', 'startsAt', 'endsAt', '_status'],
			components: {
				beforeListTable: [{ path: `${RSC}#StageFilterBar`, serverProps: { slug: options.slug } }],
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
		versions: { drafts: true },
		hooks: {
			beforeOperation: [publishUnlessDraft],
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
					{ value: 'draft', label: labelForKey(keys.statusDraft) },
					{ value: 'pending', label: labelForKey(keys.statusPending) },
					{ value: 'announced', label: labelForKey(keys.statusAnnounced) },
					{ value: 'active', label: labelForKey(keys.statusActive) },
					{ value: 'ended', label: labelForKey(keys.statusEnded) },
				],
				admin: {
					readOnly: true,
					position: 'sidebar',
					components: { Field: `${CLIENT}#StatusField`, Cell: `${CLIENT}#StatusCell` },
				},
				hooks: { afterRead: [liveStatus] },
			},
			{
				type: 'row',
				fields: [
					{
						name: 'announceAt',
						type: 'date',
						timezone,
						label: labelForKey(keys.fieldAnnounceAt),
						admin: {
							date: { pickerAppearance: 'dayAndTime' },
							description: labelForKey(keys.fieldAnnounceAtDescription),
							condition: (_data, siblingData) => siblingData?.announce === true,
						},
					},
					{
						name: 'startsAt',
						type: 'date',
						timezone,
						label: labelForKey(keys.fieldStartsAt),
						admin: {
							date: { pickerAppearance: 'dayAndTime' },
							description: labelForKey(keys.fieldStartsAtDescription),
						},
					},
					{
						name: 'endsAt',
						type: 'date',
						timezone,
						label: labelForKey(keys.fieldEndsAt),
						admin: {
							date: { pickerAppearance: 'dayAndTime' },
							condition: (_data, siblingData) => siblingData?.endAtTime === true,
						},
					},
				],
			},
			...scopeFields.main,
			{
				type: 'tabs',
				tabs: [
					{
						label: labelForKey(keys.tabActive),
						description: labelForKey(keys.fieldActiveMessageDescription),
						fields: [
							{
								name: 'activeMessage',
								type: 'richText',
								localized: Boolean(config.localization),
								label: labelForKey(keys.fieldMessage),
								editor,
							},
						],
					},
					{
						label: labelForKey(keys.tabAnnouncement),
						// Only a window that announces itself has an announcement to write.
						admin: { condition: (data) => data?.announce === true },
						description: labelForKey(keys.fieldAnnouncementMessageDescription),
						fields: [
							{
								name: 'announcementMessage',
								type: 'richText',
								localized: Boolean(config.localization),
								label: labelForKey(keys.fieldMessage),
								editor,
							},
						],
					},
				],
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
			{
				// No default: a write setting `announceAt` without it (API, scripts)
				// still announces; only an explicit `false` drops the date.
				name: 'announce',
				type: 'checkbox',
				hooks: {
					// A window stored without the toggle announces when it has a date.
					afterRead: [
						({ value, siblingData }) =>
							typeof value === 'boolean' ? value : Boolean(siblingData?.announceAt),
					],
				},
				label: labelForKey(keys.fieldAnnounce),
				admin: { position: 'sidebar' },
			},
			{
				name: 'endAtTime',
				type: 'checkbox',
				defaultValue: false,
				label: labelForKey(keys.fieldEndAtTime),
				admin: { position: 'sidebar' },
			},
			...scopeFields.sidebar,
		],
	}
	return collectionOptions?.overrides ? collectionOptions.overrides(collection) : collection
}
