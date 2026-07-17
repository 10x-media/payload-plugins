import {
	type CollectionBeforeValidateHook,
	type CollectionConfig,
	type Field,
	type PayloadRequest,
	ValidationError,
} from 'payload'
import type { RichTextBodyOption } from '../actions/body/serializeBody'
import { buildActionBlocks } from '../actions/buildActionBlocks'
import type { FromAddressesResolver } from '../actions/fromAddresses'
import { resolveFromAddressesRequest } from '../actions/fromAddresses'
import type { ActionRegistry } from '../actions/registry'
import {
	type FormResultsAccess,
	resolveFormResultsRequest,
} from '../aggregation/resolveResultsRequest'
import { normalizeCalc } from '../calc/normalizeCalc'
import { buildConditionTypeMap } from '../conditions/conditionType'
import { type FieldRow, normalizeFormConditions } from '../conditions/normalizeConditions'
import { resolveConsentSourcesRequest } from '../consent/resolveConsentSourcesRequest'
import type { ConsentSourcesResolver } from '../consent/types'
import { buildFieldBlocks } from '../fields/buildFieldBlocks'
import { localizedIf } from '../fields/localizedIf'
import type { FieldTypeRegistry } from '../fields/registry'
import { normalizeFlow } from '../flow/normalizeFlow'
import { END_OF_FORM } from '../flow/types'
import { isLoggedIn } from '../plugin/access'
import type { CollectionOverrides } from '../plugin/collectionOverrides'
import { buildPollOptionSourceFields } from '../poll/buildPollOptionSourceFields'
import { pollOutcomeBeforeChange } from '../poll/outcomeBeforeChange'
import { buildDefaultOutcomeFields, type OutcomeFieldsOverride } from '../poll/outcomeFields'
import type { PollOptionSourceRegistry } from '../poll/registry'
import { resolvePollOptionsRequest } from '../poll/resolvePollOptionsRequest'
import { buildValidateResultsField, pollEligibleTypes } from '../poll/resultsField'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import type { ValidationRuleRegistry } from '../validation/registry'
import { validateUrl } from '../validation/validateUrl'
import { type ButtonsOption, buildDefaultButtonFields } from './buttonFields'

export const FORMS_SLUG = 'forms'

/**
 * Field-level validation for the raw flow JSON: step ids must be non-empty, unique, and not the
 * reserved `END_OF_FORM` sentinel, and every explicit step-id reference (a string `next`, a
 * transition `to`) must resolve to a known step. `next: null` (explicit end of form) and an
 * absent `next` (fall through to the next step in array order) are always valid. On full-document
 * saves the beforeValidate pass has already run `normalizeFlow` and laundered dangling
 * references, so the unknown-target checks mainly protect partial API updates that send `flow`
 * without `fields`.
 */
const validateFlow = (raw: unknown): string | true => {
	if (raw === null || raw === undefined) return true
	const r = raw as Record<string, unknown>
	if (!Array.isArray(r.steps)) return true
	const steps = r.steps as Array<Record<string, unknown>>
	const emptyIdStep = steps.find((s) => typeof s?.id !== 'string' || s.id.length === 0)
	if (emptyIdStep) return 'Flow: every step must have a non-empty ID'
	if (steps.some((s) => s.id === END_OF_FORM)) {
		return `Flow: step ID "${END_OF_FORM}" is reserved`
	}
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
	/**
	 * The plugin `consent.sources` option. Present: the `/:id/consent-sources` endpoint backing the
	 * consent field's source select is registered. Absent: neither it nor the consent field type exists.
	 */
	consentSources?: ConsentSourcesResolver
	actionRegistry?: ActionRegistry
	localizeContent?: boolean
	/** The plugin `richText` option; `editor` overrides the response message's richText editor. */
	richText?: RichTextBodyOption
	/** The host-owned uploads collection slug from plugin config; absent when uploads are disabled. */
	uploadsCollectionSlug?: string
	/** Host seam gating anonymous results reads (plugin option `results.access`). */
	resultsAccess?: FormResultsAccess
	/** Registered poll option sources (plugin option `poll.sources`); empty registry means no source fields. */
	pollSourceRegistry?: PollOptionSourceRegistry
	/** The plugin `poll.outcomeFields` seam; composes the outcome group from the two default fields. */
	outcomeFields?: OutcomeFieldsOverride
	/** The plugin `buttons` option; `fields` composes the buttons group from the localized defaults. */
	buttons?: ButtonsOption
	/**
	 * The plugin `email.fromAddresses` option. Present: both email actions gain a `from` select and
	 * the `/:id/from-addresses` endpoint is registered. Absent: neither exists.
	 */
	fromAddresses?: FromAddressesResolver
	overrides?: CollectionOverrides
}

export const buildFormsCollection = ({
	overrides,
	registry,
	ruleRegistry,
	consentSources,
	actionRegistry = new Map(),
	localizeContent = true,
	richText,
	uploadsCollectionSlug,
	resultsAccess,
	pollSourceRegistry,
	outcomeFields,
	buttons,
	fromAddresses,
}: BuildFormsCollectionArgs): CollectionConfig => {
	const conditionTypes = buildConditionTypeMap(registry)
	const pollResultsTypes = pollEligibleTypes(registry)
	const bareTypes = new Set(
		[...registry.values()].filter((d) => d.bare === true).map((d) => d.type)
	)
	// Handed to the FlowBuilder so it can list bare (nameless) blocks in the step picker: slug ->
	// label (an i18n key or literal, resolved client-side).
	const bareTypeLabels = Object.fromEntries(
		[...registry.values()].filter((d) => d.bare === true).map((d) => [d.type, d.label])
	)
	const FLOW_BUILDER_REF = '@10x-media/form-builder/client#FlowBuilder'
	const FIELD_NAME_SELECT_REF = '@10x-media/form-builder/client#FieldNameSelect'

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
			// Flow step assignments store field keys: machine names for named fields, block row ids
			// for bare (nameless) blocks. Mirrors `fieldKey` over the raw rows.
			const fieldKeys = normalized
				.map((field: FieldRow) => {
					if (typeof field.name === 'string' && field.name.length > 0) {
						return field.name
					}
					return bareTypes.has(field.blockType) && field.id != null ? String(field.id) : undefined
				})
				.filter((key): key is string => key !== undefined)
			const normalizedFlow = normalizeFlow(data.flow, fieldKeys)
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
		blocks: buildFieldBlocks({ registry, ruleRegistry, localize: localizeContent }),
	}

	const flowField: Field = {
		name: 'flow',
		type: 'json',
		validate: validateFlow,
		admin: {
			components: {
				Field: { path: FLOW_BUILDER_REF, clientProps: { conditionTypes, bareTypeLabels } },
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
								next: { type: ['string', 'null'] as ('string' | 'null')[] },
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
	// client renderer needs message/redirect. `type`/`url` are behavior, never localized;
	// `message` is visitor-facing content and follows `localizeContent`.
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
				...(richText?.editor ? { editor: richText.editor } : {}),
				...localizedIf(localizeContent),
			},
			{
				name: 'redirect',
				type: 'group',
				label: labelForKey(keys.responseRedirect),
				admin: {
					condition: (_data, siblingData) => siblingData?.type === 'redirect',
					hideGutter: true,
				},
				fields: [
					{
						name: 'url',
						type: 'text',
						label: labelForKey(keys.responseUrl),
						validate: validateUrl,
					},
				],
			},
		],
	}

	// Form-level button labels, at the bottom of the Fields tab; visitor-facing content following
	// `localizeContent`. The `buttons.fields` seam receives the already-localized defaults and its
	// return becomes the group's fields verbatim, so a host can wrap a default in a row with its
	// own field (e.g. an icon select), reorder, or drop one. Host-added fields ride along on
	// `FormDocument.buttons` for custom chrome to read.
	const defaultOutcomeFields = buildDefaultOutcomeFields()
	const defaultButtonFields = buildDefaultButtonFields(localizeContent)
	// Half-width copy of a default field for the prev/next row; preserves the field's own admin
	// (e.g. the multi-step description) rather than replacing it. The cast is safe: `width` is a
	// valid admin option on every field variant, but spreading a `Field`-typed value's `admin`
	// back into a union-typed object literal loses the discriminant TS needs to check it structurally.
	const halfWidth = (field: Field): Field =>
		({ ...field, admin: { ...field.admin, width: '50%' } }) as Field
	const buttonsField: Field = {
		name: 'buttons',
		type: 'group',
		label: labelForKey(keys.buttonsGroup),
		fields: buttons?.fields
			? buttons.fields({ defaultFields: defaultButtonFields })
			: [
					defaultButtonFields.submit,
					{
						type: 'row',
						fields: [halfWidth(defaultButtonFields.prev), halfWidth(defaultButtonFields.next)],
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
				{ label: labelForKey(keys.tabFields), fields: [fieldsField, buttonsField] },
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
				// Authored by picking from the form's poll-eligible fields; the stored value stays a
				// plain text field name. Select options and server validate share `pollResultsTypes`,
				// so they cannot drift.
				{
					name: 'resultsField',
					type: 'text',
					label: labelForKey(keys.pollResultsField),
					validate: buildValidateResultsField(pollResultsTypes),
					admin: {
						condition: (_data, siblingData) => Boolean(siblingData?.enabled),
						components: {
							Field: {
								path: FIELD_NAME_SELECT_REF,
								clientProps: {
									types: pollResultsTypes,
									descriptionKey: keys.pollResultsFieldDescription,
								},
							},
						},
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
				// `winningValue` is recorded either by an admin picking from the poll's effective options
				// (served by `/:id/poll-options`) or by `resolvePollOutcome` (host domain logic); the
				// `pollOutcomeBeforeChange` hook validates both paths and owns the `resolvedAt` stamp.
				// `resolvedAt` itself stays fully locked: field-level create/update access blocks every
				// non-override caller write (Payload silently drops the denied value rather than erroring)
				// while the hook's stamp, applied after access filtering, still persists. The
				// `poll.outcomeFields` seam receives both defaults and its return becomes the group's
				// fields verbatim, so a host can swap `winningValue` for its own component; the hook
				// still validates the stored value against the effective options, so no swap bypasses it.
				{
					name: 'outcome',
					type: 'group',
					label: labelForKey(keys.pollOutcome),
					admin: {
						condition: (_data, siblingData) => Boolean(siblingData?.enabled),
						hideGutter: true,
					},
					fields: outcomeFields
						? outcomeFields({ defaultFields: defaultOutcomeFields })
						: [defaultOutcomeFields.winningValue, defaultOutcomeFields.resolvedAt],
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
					eligibleTypes: pollResultsTypes,
				})
				return Response.json(body, { status })
			},
		},
		{
			path: '/:id/poll-options',
			method: 'get',
			handler: async (req: PayloadRequest) => {
				const { status, body } = await resolvePollOptionsRequest({
					payload: req.payload,
					formId: req.routeParams?.id as number | string | undefined,
					isAuthed: Boolean(req.user),
					req,
				})
				return Response.json(body, { status })
			},
		},
		...(consentSources
			? [
					{
						path: '/:id/consent-sources',
						method: 'get' as const,
						handler: async (req: PayloadRequest) => {
							const { status, body } = await resolveConsentSourcesRequest({
								payload: req.payload,
								formId: req.routeParams?.id as number | string | undefined,
								isAuthed: Boolean(req.user),
								req,
								resolver: consentSources,
							})
							return Response.json(body, { status })
						},
					},
				]
			: []),
		// The route id is unused: the from-addresses set is request-scoped (e.g. per tenant), not
		// per-form. Registered as a doc-scoped route only so the admin field can reuse
		// EndpointOptionsSelect unmodified (see buildFromField).
		...(fromAddresses
			? [
					{
						path: '/:id/from-addresses',
						method: 'get' as const,
						handler: async (req: PayloadRequest) => {
							const { status, body } = await resolveFromAddressesRequest({
								isAuthed: Boolean(req.user),
								req,
								resolver: fromAddresses,
							})
							return Response.json(body, { status })
						},
					},
				]
			: []),
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
			beforeChange: [pollOutcomeBeforeChange, ...(overrides?.hooks?.beforeChange ?? [])],
		},
		endpoints: [
			...defaultEndpoints,
			...(Array.isArray(overrides?.endpoints) ? overrides.endpoints : []),
		],
		fields: overrides?.fields ? overrides.fields({ defaultFields }) : defaultFields,
	}
}
