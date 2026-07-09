import {
	APIError,
	type CollectionBeforeChangeHook,
	type CollectionBeforeValidateHook,
	type CollectionConfig,
	type Config,
	type Field,
	type LabelFunction,
	type PayloadComponent,
} from 'payload'

import type { JobsOptions } from '../options'
import { keys } from '../translations/keys'
import { asTranslate, labelForKey } from '../translations/server'
import { collectJobLabels, type JobLabelMaps } from './labelMaps'
import { resolve } from './resolve'
import {
	collectJobSelectSlugs,
	jobSelectField,
	taskCondition,
	unionSelectValues,
	workflowCondition,
} from './selectFields'

const STATUS_CELL = '@10x-media/jobs/client#JobStatusCell'
const STATUS_HEADER = '@10x-media/jobs/client#JobStatusHeader'
const RELATIVE_CELL = '@10x-media/jobs/client#RelativeTimeCell'
const ERROR_PANEL = '@10x-media/jobs/client#JobErrorPanel'
const LOG_TIMELINE = '@10x-media/jobs/client#JobLogTimeline'
const DOC_DESCRIPTION = '@10x-media/jobs/client#JobDocDescription'
const HEALTH_BAR = '@10x-media/jobs/rsc#JobsHealthBar'
const WAIT_UNTIL_FIELD = '@10x-media/jobs/client#WaitUntilField'
const JOB_TITLE_CELL = '@10x-media/jobs/client#JobTitleCell'
const QUEUE_SELECT_FIELD = '@10x-media/jobs/client#QueueSelectField'

/** Stored field that titles the document: the workflow or task the job runs. */
const TITLE_FIELD: Field = {
	name: 'jobTitle',
	type: 'text',
	label: labelForKey(keys.fieldJob),
	admin: {
		// Form-only hide: admin.hidden would also strip it from list columns.
		condition: () => false,
		disableBulkEdit: true,
	},
}

/**
 * Keep `jobTitle` in sync with the job's workflow or task on every write, falling
 * back to the existing doc so partial state updates never clobber it.
 */
const setJobTitle: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
	const source = { ...(originalDoc ?? {}), ...data } as Record<string, unknown>
	const workflow = typeof source.workflowSlug === 'string' ? source.workflowSlug : undefined
	const task = typeof source.taskSlug === 'string' ? source.taskSlug : undefined
	const title = workflow || task
	return title ? { ...data, jobTitle: title } : data
}

/** A job runs a workflow or a task; reject documents claiming both. */
const rejectWorkflowAndTask: CollectionBeforeValidateHook = ({
	data,
	operation,
	originalDoc,
	req,
}) => {
	if (operation !== 'create') {
		return data
	}
	const merged = { ...(originalDoc ?? {}), ...(data ?? {}) } as Record<string, unknown>
	if (merged.workflowSlug && merged.taskSlug) {
		throw new APIError(asTranslate(req.t)(keys.errorWorkflowTaskExclusive), 400)
	}
	return data
}

/** Our default document Field component for specific job fields. */
const FIELD_COMPONENTS: Record<string, PayloadComponent> = {
	error: ERROR_PANEL,
	waitUntil: WAIT_UNTIL_FIELD,
}

const DEFAULT_JOBS_COLUMNS = ['jobTitle', 'status', 'queue', 'totalTried', 'updatedAt']

/** Friendlier labels for a few of Payload's default job fields. */
const FIELD_LABELS: Record<string, LabelFunction> = {
	totalTried: labelForKey(keys.fieldAttempts),
	waitUntil: labelForKey(keys.fieldScheduledFor),
	workflowSlug: labelForKey(keys.fieldWorkflow),
}

/**
 * Payload appends `createdAt`/`updatedAt` after overrides run, but only when they
 * are absent, so we inject our own to attach the relative-time cell to them.
 */
const TIMESTAMP_FIELDS: Field[] = [
	{
		name: 'createdAt',
		type: 'date',
		label: labelForKey(keys.fieldCreated),
		index: true,
		admin: { disableBulkEdit: true, hidden: true },
	},
	{
		name: 'updatedAt',
		type: 'date',
		label: labelForKey(keys.fieldUpdated),
		index: true,
		admin: { disableBulkEdit: true, hidden: true },
	},
]

const fieldName = (field: Field): string | undefined =>
	'name' in field && typeof field.name === 'string' ? field.name : undefined

const setCell = (field: Field, cell: PayloadComponent): Field =>
	({
		...field,
		admin: { ...field.admin, components: { ...field.admin?.components, Cell: cell } },
	}) as Field

/**
 * Resolve a field's list cell: an explicit `cells` override wins (`false` keeps
 * Payload's default), otherwise date fields get the relative-time cell.
 */
const resolveCell = (field: Field, cells: JobsOptions['cells']): Field => {
	const name = fieldName(field)
	const override = name ? cells?.[name] : undefined
	if (override === false) {
		return field
	}
	if (override) {
		return setCell(field, override)
	}
	if (field.type === 'date') {
		return setCell(field, RELATIVE_CELL)
	}
	return field
}

/** Execution-state fields surfaced in the header; hidden from the form, kept as data/columns. */
const HIDE_ALWAYS = new Set(['completedAt', 'totalTried', 'hasError', 'processing', 'taskStatus'])
/** Execution output: read-only in the admin (admin-only, so the runner can still write it). */
const READONLY_OUTPUTS = new Set(['error', 'log'])
/** Config inputs: editable on Create, read-only on edit; kept in the sidebar. */
const READONLY_INPUTS = new Set(['input', 'workflowSlug', 'taskSlug', 'queue', 'waitUntil'])

/**
 * Lock a field for the read-only-record model. Runner-written fields use
 * admin-only props (`hidden`/`readOnly`) so the jobs runner is never blocked;
 * inputs use field `access.update` so they stay editable on Create but lock once
 * the job exists.
 */
const lockField = (field: Field, name: string): Field => {
	if (HIDE_ALWAYS.has(name)) {
		return { ...field, admin: { ...field.admin, hidden: true } } as Field
	}
	if (READONLY_OUTPUTS.has(name)) {
		return { ...field, admin: { ...field.admin, readOnly: true } } as Field
	}
	if (READONLY_INPUTS.has(name)) {
		const access = 'access' in field && field.access ? field.access : {}
		return { ...field, access: { ...access, update: () => false } } as Field
	}
	return field
}

type EnhanceContext = {
	cells: JobsOptions['cells']
	fieldComponents: Record<string, PayloadComponent>
	lockRecord: boolean
}

/** Recursively relabel fields, apply cell overrides, and lock the record, descending into tabs. */
const enhanceFields = (fields: Field[], ctx: EnhanceContext): Field[] =>
	fields.map((field): Field => {
		let next = field
		const name = fieldName(field)
		if (name && FIELD_LABELS[name]) {
			next = { ...field, label: FIELD_LABELS[name] } as Field
		}
		next = resolveCell(next, ctx.cells)
		if (ctx.lockRecord && name) {
			next = lockField(next, name)
		}
		if (name && ctx.fieldComponents[name]) {
			next = {
				...next,
				admin: {
					...next.admin,
					components: { ...next.admin?.components, Field: ctx.fieldComponents[name] },
				},
			} as Field
		}
		if ('tabs' in next) {
			next = {
				...next,
				tabs: next.tabs.map((tab) => ({
					...tab,
					fields: enhanceFields(tab.fields, ctx),
				})),
			} as Field
		} else if ('fields' in next) {
			next = { ...next, fields: enhanceFields(next.fields, ctx) } as Field
		}
		return next
	})

/** Build the derived Status column, honoring the `status` override (`false` removes it). */
const buildStatusField = (status: JobsOptions['status'], labels: JobLabelMaps): Field | null => {
	if (status === false) {
		return null
	}
	return {
		name: 'status',
		type: 'ui',
		label: labelForKey(keys.fieldStatus),
		admin: {
			components: {
				Cell: status ?? STATUS_CELL,
				Field: {
					clientProps: {
						taskLabels: labels.taskLabels,
						workflowLabels: labels.workflowLabels,
					},
					path: STATUS_HEADER,
				},
			},
		},
	} as Field
}

/**
 * Enhance Payload's built-in `payload-jobs` collection through its sanctioned
 * `jobs.jobsCollectionOverrides` seam. Composes with a host-provided override
 * (ours layer on top of theirs) so neither clobbers the other, and every piece
 * is replaceable through `options` (`status`, `cells`, `beforeListTable`).
 */
export const registerJobsEnhancements = (
	config: Config,
	options: JobsOptions,
	extraQueues: string[] = []
): void => {
	const existing = config.jobs?.jobsCollectionOverrides

	const enhance = ({
		defaultJobsCollection,
	}: {
		defaultJobsCollection: CollectionConfig
	}): CollectionConfig => {
		const base = existing ? existing({ defaultJobsCollection }) : defaultJobsCollection
		const existingNames = new Set(
			base.fields.flatMap((field) => {
				const name = fieldName(field)
				return name ? [name] : []
			})
		)

		const timestamps = TIMESTAMP_FIELDS.filter((field) => {
			const name = fieldName(field)
			return name ? !existingNames.has(name) : false
		}).map((field) => resolveCell(field, options.cells))

		// Top-level swap only: the log array nests its own required taskSlug field.
		// Existing option values are kept (core seeds runtime-only slugs like `inline`
		// that the db-level select enum must keep accepting). The queue field keeps
		// its text type under a select component: a real select would harden the
		// options into a db enum and reject the arbitrary queue names
		// `payload.jobs.queue()` may target.
		const slugs = collectJobSelectSlugs(config, extraQueues)
		const labels = collectJobLabels(config)
		const fieldComponents: Record<string, PayloadComponent> = {
			...FIELD_COMPONENTS,
			log: { clientProps: { taskLabels: labels.taskLabels }, path: LOG_TIMELINE },
		}
		const withSelects = base.fields.map((field): Field => {
			const name = fieldName(field)
			if (name === 'workflowSlug') {
				return {
					...jobSelectField(field, unionSelectValues(field, slugs.workflows)),
					admin: { ...field.admin, condition: workflowCondition(slugs.workflows.length) },
				} as Field
			}
			if (name === 'taskSlug') {
				return {
					...jobSelectField(field, unionSelectValues(field, slugs.tasks)),
					admin: { ...field.admin, condition: taskCondition(slugs.tasks.length) },
				} as Field
			}
			if (name === 'queue') {
				return {
					...field,
					admin: {
						...field.admin,
						components: {
							...field.admin?.components,
							Field: { clientProps: { options: slugs.queues }, path: QUEUE_SELECT_FIELD },
						},
					},
				} as Field
			}
			return field
		})

		const statusField = buildStatusField(options.status, labels)
		const titleField: Field = {
			...TITLE_FIELD,
			admin: {
				...TITLE_FIELD.admin,
				components: {
					Cell: {
						clientProps: {
							taskLabels: labels.taskLabels,
							workflowLabels: labels.workflowLabels,
						},
						path: JOB_TITLE_CELL,
					},
				},
			},
		}
		const lockRecord = options.readOnlyRecord !== false
		const hostBeforeTable = base.admin?.components?.beforeListTable ?? []
		const ourBeforeTable: PayloadComponent[] =
			options.beforeListTable === false
				? []
				: (options.beforeListTable ?? [
						{ path: HEALTH_BAR, serverProps: { cap: options.healthBarCap } },
					])

		return {
			...base,
			admin: {
				...base.admin,
				hidden: options.hidden ?? false,
				useAsTitle: 'jobTitle',
				defaultColumns: resolve(options.defaultColumns, DEFAULT_JOBS_COLUMNS),
				// jobTitle is only synced by a beforeChange hook; runtime-queued docs
				// bypass hooks by default, so list search must cover the raw slugs too.
				listSearchableFields: base.admin?.listSearchableFields ?? [
					'jobTitle',
					'workflowSlug',
					'taskSlug',
					'queue',
				],
				components: {
					...base.admin?.components,
					Description: DOC_DESCRIPTION,
					beforeListTable: [...hostBeforeTable, ...ourBeforeTable],
				},
			},
			hooks: {
				...base.hooks,
				beforeChange: [...(base.hooks?.beforeChange ?? []), setJobTitle],
				beforeValidate: [...(base.hooks?.beforeValidate ?? []), rejectWorkflowAndTask],
			},
			fields: [
				...(statusField ? [statusField] : []),
				titleField,
				...enhanceFields(withSelects, { cells: options.cells, fieldComponents, lockRecord }),
				...timestamps,
			],
		} as CollectionConfig
	}

	config.jobs = { ...config.jobs, jobsCollectionOverrides: enhance }
}
