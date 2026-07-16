import {
	type CollectionBeforeValidateHook,
	type CollectionConfig,
	type Field,
	type PayloadRequest,
	ValidationError,
} from 'payload'
import { buildActionBlocks } from '../actions/buildActionBlocks'
import type { ActionRegistry } from '../actions/registry'
import {
	type FormResultsAccess,
	resolveFormResultsRequest,
} from '../aggregation/resolveResultsRequest'
import { normalizeCalc } from '../calc/normalizeCalc'
import { buildConditionTypeMap } from '../conditions/conditionType'
import { type FieldRow, normalizeFormConditions } from '../conditions/normalizeConditions'
import type { ConsentSourceRegistry } from '../consent/registry'
import { buildFieldBlocks } from '../fields/buildFieldBlocks'
import { localizedIf } from '../fields/localizedIf'
import type { FieldTypeRegistry } from '../fields/registry'
import { normalizeFlow } from '../flow/normalizeFlow'
import { isLoggedIn } from '../plugin/access'
import type { CollectionOverrides } from '../plugin/collectionOverrides'
import { buildPollOptionSourceFields } from '../poll/buildPollOptionSourceFields'
import type { PollOptionSourceRegistry } from '../poll/registry'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import type { ValidationRuleRegistry } from '../validation/registry'
import { validateUrl } from '../validation/validateUrl'

export const FORMS_SLUG = 'forms'

const validateFlow = (raw: unknown): string | true => {
	if (raw === null || raw === undefined) return true
	const r = raw as Record<string, unknown>
	if (!Array.isArray(r.steps)) return true
	const steps = r.steps as Array<Record<string, unknown>>
	const emptyIdStep = steps.find((s) => typeof s?.id !== 'string' || s.id.length === 0)
	if (emptyIdStep) return 'Flow: every step must have a non-empty ID'
	const ids = steps.map((s) => s.id as string)
	if (new Set(ids).size !== ids.length) {
		return 'Flow: duplicate step IDs found'
	}
	const idSet = new Set(ids)
	for (const step of steps) {
		const id = step.id as string
		if (typeof step.next === 'string' && step.next.length > 0 && !idSet.has(step.next)) {
			return `Flow: step "${id}" references unknown next step "${step.next}"`
		}
		if (Array.isArray(step.transitions)) {
			for (const t of step.transitions as Array<Record<string, unknown>>) {
				if (typeof t?.to === 'string' && t.to.length > 0 && !idSet.has(t.to)) {
					return `Flow: step "${id}" has a transition to unknown step "${t.to}"`
				}
			}
		}
	}
	return true
}

/** How many steps the caller actually submitted, before normalization strips/collapses the flow. */
const providedFlowStepCount = (raw: unknown): number => {
	if (raw === null || typeof raw !== 'object') return 0
	const steps = (raw as { steps?: unknown }).steps
	return Array.isArray(steps) ? steps.length : 0
}

/**
 * Stamp the configured uploads collection slug onto every `file` block (including repeater
 * sub-fields) on each save. The block carries a hidden `uploadsCollection` field so the slug
 * reaches the client renderer through the form document; the server always overwrites it from
 * plugin config, so the stored value is never author- or client-controlled.
 */
const stampFileCollections = (rows: FieldRow[], slug: string): void => {
	for (const row of rows) {
		if (row.blockType === 'file') {
			;(row as { uploadsCollection?: string }).uploadsCollection = slug
		}
		const subFields = (row as { subFields?: unknown }).subFields
		if (Array.isArray(subFields)) {
			stampFileCollections(subFields as FieldRow[], slug)
		}
	}
}

type BuildFormsCollectionArgs = {
	registry: FieldTypeRegistry
	ruleRegistry: ValidationRuleRegistry
	consentRegistry?: ConsentSourceRegistry
	actionRegistry?: ActionRegistry
	localizeContent?: boolean
	/** The host-owned uploads collection slug from plugin config; absent when uploads are disabled. */
	uploadsCollectionSlug?: string
	/** Host seam gating anonymous results reads (plugin option `results.access`). */
	resultsAccess?: FormResultsAccess
	/** Registered poll option sources (plugin option `poll.sources`); empty registry means no source fields. */
	pollSourceRegistry?: PollOptionSourceRegistry
	overrides?: CollectionOverrides
}

export const buildFormsCollection = ({
	overrides,
	registry,
	ruleRegistry,
	consentRegistry,
	actionRegistry = new Map(),
	localizeContent = true,
	uploadsCollectionSlug,
	resultsAccess,
	pollSourceRegistry,
}: BuildFormsCollectionArgs): CollectionConfig => {
	const conditionTypes = buildConditionTypeMap(registry)
	const FLOW_BUILDER_REF = '@10x-media/form-builder/client#FlowBuilder'

	const beforeValidate: CollectionBeforeValidateHook = ({ data, req }) => {
		if (data && Array.isArray(data.fields)) {
			const normalized: FieldRow[] = normalizeFormConditions(
				data.fields as FieldRow[],
				conditionTypes
			)
			for (const field of normalized) {
				if ('expression' in field) {
					field.expression = normalizeCalc(field.expression)
				}
			}
			if (uploadsCollectionSlug) {
				stampFileCollections(normalized, uploadsCollectionSlug)
			}
			data.fields = normalized
			const fieldNames = normalized
				.map((field: FieldRow) => (typeof field.name === 'string' ? field.name : undefined))
				.filter((name): name is string => name !== undefined)
			const normalizedFlow = normalizeFlow(data.flow, fieldNames)
			// A flow the author built but that collapses to fewer than two valid steps would
			// otherwise vanish silently. Surface it instead of discarding their work.
			if (providedFlowStepCount(data.flow) > 0 && normalizedFlow === undefined) {
				throw new ValidationError(
					{
						collection: FORMS_SLUG,
						errors: [
							{
								path: 'flow',
								message: 'A flow needs at least two steps. Add another step or remove the flow.',
							},
						],
					},
					req.t
				)
			}
			data.flow = normalizedFlow
		}
		return data
	}

	const fieldsField: Field = {
		name: 'fields',
		type: 'blocks',
		blocks: buildFieldBlocks({
			registry,
			ruleRegistry,
			consentRegistry,
			localize: localizeContent,
		}),
	}

	const flowField: Field = {
		name: 'flow',
		type: 'json',
		validate: validateFlow,
		admin: {
			components: {
				Field: { path: FLOW_BUILDER_REF, clientProps: { conditionTypes } },
			},
		},
		// Narrows the generated TypeScript type from opaque JSON to FormFlow so callers
		// don't need a cast. Keep this in sync with src/flow/types.ts.
		typescriptSchema: [
			() => ({
				type: 'object' as const,
				required: ['steps'],
				additionalProperties: false,
				properties: {
					steps: {
						type: 'array' as const,
						items: {
							type: 'object' as const,
							required: ['id'],
							additionalProperties: true,
							properties: {
								id: { type: 'string' as const },
								title: { type: 'string' as const },
								fields: { type: 'array' as const, items: { type: 'string' as const } },
								next: { type: 'string' as const },
								transitions: {
									type: 'array' as const,
									items: {
										type: 'object' as const,
										required: ['to'],
										additionalProperties: true,
										properties: {
											to: { type: 'string' as const },
											when: { type: 'object' as const, additionalProperties: true },
										},
									},
								},
							},
						},
					},
				},
			}),
		],
	}

	const actionsField: Field = {
		name: 'actions',
		type: 'blocks',
		blocks: buildActionBlocks(actionRegistry),
		label: labelForKey(keys.configActions),
		// Action config can contain secrets (e.g. signedWebhook.secret). The collection
		// itself is publicly readable so forms can be rendered by anonymous clients, but
		// action config must never be exposed to anonymous callers.
		access: { read: isLoggedIn },
	}

	// What the visitor sees after a successful submit. Publicly readable (unlike actions): the
	// client renderer needs message/redirect/submitLabel. `type`/`url` are behavior, never
	// localized; `message`/`submitLabel` are visitor-facing content and follow `localizeContent`.
	// `type` is defaulted and not clearable rather than `required`: a required member would make
	// the whole group required in generated types, breaking typed `payload.create` calls that
	// omit `response`. Consumers treat a missing type as 'message'.
	const responseField: Field = {
		name: 'response',
		type: 'group',
		fields: [
			{
				name: 'type',
				type: 'select',
				defaultValue: 'message',
				label: labelForKey(keys.responseType),
				admin: { isClearable: false },
				options: [
					{ label: labelForKey(keys.responseTypeMessage), value: 'message' },
					{ label: labelForKey(keys.responseTypeRedirect), value: 'redirect' },
				],
			},
			{
				name: 'message',
				type: 'richText',
				label: labelForKey(keys.responseMessage),
				// Unset type (docs predating this field) means 'message', matching the client fallback.
				admin: { condition: (_data, siblingData) => siblingData?.type !== 'redirect' },
				...localizedIf(localizeContent),
			},
			{
				name: 'redirect',
				type: 'group',
				label: labelForKey(keys.responseRedirect),
				admin: { condition: (_data, siblingData) => siblingData?.type === 'redirect' },
				fields: [
					{
						name: 'url',
						type: 'text',
						label: labelForKey(keys.responseUrl),
						validate: validateUrl,
					},
				],
			},
			{
				name: 'submitLabel',
				type: 'text',
				label: labelForKey(keys.responseSubmitLabel),
				...localizedIf(localizeContent),
			},
		],
	}

	const defaultFields: Field[] = [
		// The document title is the only visitor-facing text the collection renders itself: it is
		// always required (drives `useAsTitle` in the admin list/relationship views) and is passed
		// through `toFormDocument` as `FormDocument.title`. Whether and how a host renders it above
		// the fields is entirely the host's call; the plugin does not gate or duplicate it.
		{ name: 'title', type: 'text', required: true, label: labelForKey(keys.fieldTitle) },
		// Unnamed tabs are presentational only: fields/flow/actions/response stay at the document root.
		{
			type: 'tabs',
			tabs: [
				{ label: labelForKey(keys.tabFields), fields: [fieldsField] },
				{ label: labelForKey(keys.tabFlow), fields: [flowField] },
				{ label: labelForKey(keys.tabActions), fields: [actionsField] },
				{ label: labelForKey(keys.tabResponse), fields: [responseField] },
			],
		},
		// Poll lifecycle config; identifiers and behavior, never localized. Sidebar keeps parity with
		// the pre-group showResults/resultsField placement. `resultsVisibility` is defaulted and not
		// clearable rather than `required` for the same generated-types reason as `response.type`.
		{
			name: 'poll',
			type: 'group',
			label: labelForKey(keys.pollGroup),
			admin: { position: 'sidebar' },
			fields: [
				{
					name: 'enabled',
					type: 'checkbox',
					defaultValue: false,
					label: labelForKey(keys.pollEnabled),
				},
				{
					name: 'resultsField',
					type: 'text',
					label: labelForKey(keys.pollResultsField),
					admin: {
						description: labelForKey(keys.pollResultsFieldDescription),
						condition: (_data, siblingData) => Boolean(siblingData?.enabled),
					},
				},
				{
					name: 'resultsVisibility',
					type: 'select',
					defaultValue: 'afterVote',
					label: labelForKey(keys.pollResultsVisibility),
					admin: {
						isClearable: false,
						condition: (_data, siblingData) => Boolean(siblingData?.enabled),
					},
					options: [
						{ label: labelForKey(keys.pollVisibilityAfterVote), value: 'afterVote' },
						{ label: labelForKey(keys.pollVisibilityAfterClose), value: 'afterClose' },
					],
				},
				{
					name: 'closesAt',
					type: 'date',
					label: labelForKey(keys.pollClosesAt),
					admin: {
						date: { pickerAppearance: 'dayAndTime' },
						condition: (_data, siblingData) => Boolean(siblingData?.enabled),
					},
				},
				...buildPollOptionSourceFields(pollSourceRegistry ?? new Map()),
				// The outcome is written exclusively by `resolvePollOutcome` (host domain logic, server-side
				// with overrideAccess). Field-level create/update access blocks every non-override write:
				// Payload silently drops the denied value rather than erroring, so admin saves and API
				// updates can never set or clear a winner. `admin.readOnly` mirrors that in the UI.
				{
					name: 'outcome',
					type: 'group',
					label: labelForKey(keys.pollOutcome),
					admin: { condition: (_data, siblingData) => Boolean(siblingData?.enabled) },
					fields: [
						{
							name: 'winningValue',
							type: 'text',
							label: labelForKey(keys.pollWinningValue),
							admin: { readOnly: true },
							access: { create: () => false, update: () => false },
						},
						{
							name: 'resolvedAt',
							type: 'date',
							label: labelForKey(keys.pollResolvedAt),
							admin: { readOnly: true },
							access: { create: () => false, update: () => false },
						},
					],
				},
			],
		},
	]

	const defaultEndpoints: CollectionConfig['endpoints'] = [
		{
			path: '/:id/results',
			method: 'get',
			handler: async (req: PayloadRequest) => {
				const field = typeof req.query?.field === 'string' ? req.query.field : undefined
				const { status, body } = await resolveFormResultsRequest({
					payload: req.payload,
					formId: req.routeParams?.id as number | string | undefined,
					field,
					isAuthed: Boolean(req.user),
					req,
					access: resultsAccess,
				})
				return Response.json(body, { status })
			},
		},
	]

	return {
		...(overrides ?? {}),
		slug: FORMS_SLUG,
		labels: {
			singular: labelForKey(keys.collectionFormSingular),
			plural: labelForKey(keys.collectionFormPlural),
			...(overrides?.labels ?? {}),
		},
		admin: { group: 'Forms', useAsTitle: 'title', ...(overrides?.admin ?? {}) },
		access: { read: () => true, ...(overrides?.access ?? {}) },
		hooks: {
			...(overrides?.hooks ?? {}),
			// beforeValidate normalizes conditions and flow; consumer hooks run after
			beforeValidate: [beforeValidate, ...(overrides?.hooks?.beforeValidate ?? [])],
		},
		endpoints: [
			...defaultEndpoints,
			...(Array.isArray(overrides?.endpoints) ? overrides.endpoints : []),
		],
		fields: overrides?.fields ? overrides.fields({ defaultFields }) : defaultFields,
	}
}
