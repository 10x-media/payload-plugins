import {
	type CollectionAfterChangeHook,
	type CollectionAfterReadHook,
	type CollectionBeforeValidateHook,
	type CollectionConfig,
	type CollectionSlug,
	type Field,
	type TextFieldSingleValidation,
	ValidationError,
} from 'payload'
import type { RichTextBodyOption } from '../actions/body/serializeBody'
import { buildActionBlocks } from '../actions/buildActionBlocks'
import type { FromAddressesResolver } from '../actions/fromAddresses'
import type { ActionRegistry } from '../actions/registry'
import type { FormResultsAccess } from '../aggregation/resolveResultsRequest'
import { normalizeCalc } from '../calc/normalizeCalc'
import { buildConditionTypeMap } from '../conditions/conditionType'
import {
	buildOperandTypes,
	type FieldRow,
	normalizeFormConditions,
	normalizeWhere,
} from '../conditions/normalizeConditions'
import { resolveConsentStatements } from '../consent/resolveConsentStatements'
import type { ConsentSourcesResolver } from '../consent/types'
import type { DepartmentEmailsResolver } from '../email/departments'
import { buildFieldBlocks } from '../fields/buildFieldBlocks'
import { fieldNamesOfType } from '../fields/fieldNamesOfType'
import { localizedIf } from '../fields/localizedIf'
import type { FieldTypeRegistry } from '../fields/registry'
import { normalizeFlow } from '../flow/normalizeFlow'
import { END_OF_FORM } from '../flow/types'
import { isLoggedIn } from '../plugin/access'
import type { CollectionOverrides } from '../plugin/collectionOverrides'
import { buildPollOptionSourceFields } from '../poll/buildPollOptionSourceFields'
import { enqueuePollClose } from '../poll/closeJob'
import { pollOutcomeBeforeChange } from '../poll/outcomeBeforeChange'
import { buildDefaultOutcomeFields, type OutcomeFieldsOverride } from '../poll/outcomeFields'
import { type PollTypeRegistry, resolvePollTypes } from '../poll/pollTypeRegistry'
import type { PollOptionSourceRegistry } from '../poll/registry'
import { buildValidateResultsField, pollEligibleTypes } from '../poll/resultsField'
import { keys } from '../translations/keys'
import { asTranslate, labelForKey, resolveDefinitionLabel } from '../translations/server'
import type { ValidationRuleRegistry } from '../validation/registry'
import { validateUrl } from '../validation/validateUrl'
import { type ButtonsOption, buildDefaultButtonFields } from './buttonFields'
import { buildFormsEndpoints } from './formsEndpoints'
import type { ResponseOption } from './redirectFields'
import { composeSettingsFields, type SettingsOption } from './settingsFields'

export const FORMS_SLUG = 'forms'

/** `req.context` key under which `consentAfterRead` tracks the form ids it is currently resolving, to break re-entrant reads. */
const CONSENT_AFTER_READ_GUARD = 'formBuilderConsentAfterReadInFlight'

/**
 * Require the title in the default locale (and on hosts without localization), but let it be empty in
 * other locales so a localized form falls back to the default-locale title rather than forcing a
 * translation for every locale. Payload's field-level `required` cannot express this: it enforces per
 * write-locale, which would make a title mandatory in every locale and break the documented fallback.
 */
const validateFormTitle: TextFieldSingleValidation = (value, { req }) => {
	const localization = req.payload.config.localization
	const defaultLocale = localization ? localization.defaultLocale : undefined
	const enforced =
		defaultLocale === undefined || req.locale === undefined || req.locale === defaultLocale
	if (enforced && (typeof value !== 'string' || value.trim().length === 0)) {
		return req.t('validation:required')
	}
	return true
}

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
	/** Plugin `consent.resolveOnRead` (default true); `false` skips the per-read consent afterRead hook. */
	consentResolveOnRead?: boolean
	actionRegistry?: ActionRegistry
	localizeContent?: boolean
	/** The plugin `richText` option; `responseEditor ?? editor` sets the response message field's editor. */
	richText?: RichTextBodyOption
	/** The host-owned uploads collection slug from plugin config; absent when uploads are disabled. */
	uploadsCollectionSlug?: string
	/** Host seam gating anonymous results reads (plugin option `results.access`). */
	resultsAccess?: FormResultsAccess
	/** Registered poll option sources (plugin option `poll.sources`); empty registry means no source fields. */
	pollSourceRegistry?: PollOptionSourceRegistry
	/** Registered poll outcome strategies (`poll.types`); drives the poll `type` select options. Defaults to the built-ins. */
	pollTypeRegistry?: PollTypeRegistry
	/** The plugin `poll.outcomeFields` seam; composes the outcome group from the two default fields. */
	outcomeFields?: OutcomeFieldsOverride
	/** The plugin `buttons` option; `fields` composes the `{ submit, prev, next }` labels from the localized defaults. */
	buttons?: ButtonsOption
	/** The plugin `settings` option; `fields` composes the sidebar flag checkboxes from the localized defaults. */
	settings?: SettingsOption
	/** The plugin `response` option; `redirect.fields` composes the `response.redirect` group from its default fields. */
	response?: ResponseOption
	/**
	 * The plugin `email.fromAddresses` option. Present: both email actions gain a `from` select and
	 * the `/:id/from-addresses` endpoint is registered. Absent: neither exists.
	 */
	fromAddresses?: FromAddressesResolver
	/**
	 * The plugin `email.departments` option. Present: the `emailTeam` `to` becomes a department select
	 * and the `/:id/departments` endpoint backing it is registered. Absent: `to` stays a plain field.
	 */
	departments?: DepartmentEmailsResolver
	/**
	 * The plugin `redirectRelationships` option. Non-empty: `response.redirect` gains a polymorphic
	 * `reference` relationship field so an author can redirect to an internal document instead of
	 * (or alongside) a URL. Absent or empty: no `reference` field exists, matching today's URL-only
	 * redirect.
	 */
	redirectRelationships?: CollectionSlug[]
	overrides?: CollectionOverrides
}

export const buildFormsCollection = ({
	overrides,
	registry,
	ruleRegistry,
	consentSources,
	consentResolveOnRead,
	actionRegistry = new Map(),
	localizeContent = true,
	richText,
	uploadsCollectionSlug,
	resultsAccess,
	pollSourceRegistry,
	pollTypeRegistry,
	outcomeFields,
	buttons,
	settings,
	response,
	fromAddresses,
	departments,
	redirectRelationships,
}: BuildFormsCollectionArgs): CollectionConfig => {
	const conditionTypes = buildConditionTypeMap(registry)
	const pollTypes = pollTypeRegistry ?? resolvePollTypes()
	const pollResultsTypes = pollEligibleTypes(registry)
	const bareTypes = new Set(
		[...registry.values()].filter((d) => d.bare === true).map((d) => d.type)
	)
	// Handed to the FlowBuilder so it can list bare (nameless) blocks in the step picker: slug ->
	// label (an i18n key or literal, resolved client-side).
	const bareTypeLabels = Object.fromEntries(
		[...registry.values()].filter((d) => d.bare === true).map((d) => [d.type, d.label])
	)
	// The success `response` message field's editor: `richText.responseEditor` overrides the plugin-wide
	// `richText.editor` for this field alone (mirroring `bodyEditor` for action bodies).
	const responseEditor = richText?.responseEditor ?? richText?.editor
	const FLOW_BUILDER_REF = '@10x-media/form-builder/client#FlowBuilder'
	const FIELD_NAME_SELECT_REF = '@10x-media/form-builder/client#FieldNameSelect'
	const FLOW_STEPS_CELL_REF = '@10x-media/form-builder/client#FlowStepsCell'
	const FIELD_COUNT_CELL_REF = '@10x-media/form-builder/client#FieldCountCell'
	const CLOSE_POLL_BUTTON_REF = '@10x-media/form-builder/client#ClosePollButton'
	// The `source` outcome strategy delegates to the poll's option source, so it is useless without one:
	// offer it in the author-facing select only when option sources are registered. The strategy stays in
	// the registry regardless, so `resolvePollOutcome` and host code can still address it.
	const hasOptionSources = (pollSourceRegistry?.size ?? 0) > 0
	// `mostVoted` leads the author-facing select because it is the default: an enabled poll works
	// immediately, with no winner to hand-pick. Only the select order changes; the registry keeps its
	// own order (host strategies stay after the built-ins).
	const orderedPollTypes = [
		...[...pollTypes.values()].filter((strategy) => strategy.type === 'mostVoted'),
		...[...pollTypes.values()].filter((strategy) => strategy.type !== 'mostVoted'),
	]

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
			// Launder flow transition `when` clauses with the same operand-type rules as field conditions,
			// so a transition referencing a deleted field is dropped, not left as a route that always
			// matches at navigation time and force-routes the visitor.
			const operandTypes = buildOperandTypes(normalized, conditionTypes)
			const normalizedFlow = normalizeFlow(data.flow, fieldKeys, (w) =>
				normalizeWhere(w, operandTypes)
			)
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
			// A poll needs a field whose answers are the votes. With the poll enabled and no vote field
			// chosen (and the outcome not coming from an option source), bind one: auto-fill the sole
			// eligible field for a one-choice form, otherwise surface a clear error rather than storing a
			// poll that can never aggregate. The optionSource/`source` exemption preserves domain-driven
			// polls that have no on-form vote field. `buildValidateResultsField` still checks a set value;
			// this is the enforcer for enabled polls.
			if (data.pollEnabled === true) {
				const poll =
					data.poll != null && typeof data.poll === 'object'
						? (data.poll as Record<string, unknown>)
						: {}
				const resultsField = typeof poll.resultsField === 'string' ? poll.resultsField.trim() : ''
				const optionSource = typeof poll.optionSource === 'string' ? poll.optionSource.trim() : ''
				const sourceDriven = optionSource.length > 0 || poll.type === 'source'
				if (resultsField.length === 0 && !sourceDriven) {
					const eligible = fieldNamesOfType(data.fields, pollResultsTypes)
					if (eligible.length === 1) {
						data.poll = { ...poll, resultsField: eligible[0] }
					} else {
						const messageKey =
							eligible.length > 1 ? keys.pollVoteFieldChoose : keys.pollVoteFieldMissing
						throw new ValidationError(
							{
								collection: FORMS_SLUG,
								errors: [{ path: 'poll.resultsField', message: asTranslate(req.t)(messageKey) }],
							},
							req.t
						)
					}
				}
			}
		}
		return data
	}

	// After every save, (re)schedule the poll's auto-close job when it applies (enabled + closesAt +
	// unresolved + non-manual strategy + a job runner present). Best-effort and non-throwing, so it
	// never affects the save; without a runner the resolve-on-read fallback in the results endpoint
	// heals the outcome instead.
	const pollCloseAfterChange: CollectionAfterChangeHook = async ({ doc, req }) => {
		await enqueuePollClose({ payload: req.payload, form: doc, req })
		return doc
	}

	const fieldsField: Field = {
		name: 'fields',
		type: 'blocks',
		blocks: buildFieldBlocks({ registry, ruleRegistry, localize: localizeContent }),
		admin: { components: { Cell: FIELD_COUNT_CELL_REF } },
	}

	const flowField: Field = {
		name: 'flow',
		type: 'json',
		validate: validateFlow,
		admin: {
			components: {
				Cell: FLOW_STEPS_CELL_REF,
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

	// Optional polymorphic reference to an internal document, for `response.redirect` to point at
	// instead of (or alongside) a URL. Absent unless `redirectRelationships` is a non-empty array:
	// always polymorphic even for one slug (the consent `page` field's precedent), so a host adding
	// a second collection later never changes the stored shape. The plugin never resolves this to a
	// URL itself; `toFormDocument` passes the raw `{ relationTo, value }` through for the host to
	// resolve, since only the host knows its own routing.
	const redirectReferenceField: Field[] =
		redirectRelationships && redirectRelationships.length > 0
			? [
					{
						name: 'reference',
						type: 'relationship',
						relationTo: redirectRelationships,
						label: labelForKey(keys.responseRedirectReference),
						admin: { description: labelForKey(keys.responseRedirectReferenceDescription) },
					},
				]
			: []

	// The redirect group's fields: the `url` text field plus the optional polymorphic `reference`.
	// The `response.redirect.fields` seam composes them (mirroring `buttons.fields`), so a host can
	// prepend a custom link field, swap `url` for their own picker, or filter; the default (no
	// override) is the same `[url, ...reference]` as before. Built-in redirect handling still reads
	// `redirect.url`/`redirect.reference`, so a host replacing `url` owns resolving their field to a
	// destination in their frontend.
	const urlField: Field = {
		name: 'url',
		type: 'text',
		label: labelForKey(keys.responseUrl),
		validate: validateUrl,
	}
	const defaultRedirectFields: Field[] = [urlField, ...redirectReferenceField]
	const redirectFields = response?.redirect?.fields
		? response.redirect.fields({ defaultFields: defaultRedirectFields })
		: defaultRedirectFields

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
				...(responseEditor ? { editor: responseEditor } : {}),
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
				fields: redirectFields,
			},
		],
	}

	const defaultOutcomeFields = buildDefaultOutcomeFields()
	const defaultButtonFields = buildDefaultButtonFields(localizeContent)
	// Half-width copy of a default field for the prev/next row; merges width into whatever admin the
	// field already carries (a host's `buttons.fields` override may add its own) rather than replacing
	// it. The cast is safe: `width` is a valid admin option on every field variant, but spreading a
	// `Field`-typed value's `admin` back into a union-typed object literal loses the discriminant TS
	// needs to check it structurally.
	const halfWidth = (field: Field): Field =>
		({ ...field, admin: { ...field.admin, width: '50%' } }) as Field
	// The three button-label fields sit at the document root now (no `buttons` group): `submit` at
	// the bottom of the Fields tab, `prev`/`next` in a row on the Flow tab. The `buttons.fields` seam
	// composes each slot from the already-localized defaults, so a host can wrap a default in a row
	// with its own field (e.g. an icon select) or replace it; `toFormDocument` reassembles the three
	// labels into `FormDocument.buttons` for the client.
	const composedButtons = buttons?.fields
		? buttons.fields({ defaultFields: defaultButtonFields })
		: defaultButtonFields
	const submitField = composedButtons.submit
	const prevNextRow: Field = {
		type: 'row',
		// The prev/next labels only matter once the flow has a step; the Flow tab itself is gated on
		// `multistep`. `data` (1st arg) is the whole document, so `flow.steps` reads the stored flow.
		admin: {
			condition: (data) => {
				const steps = (data as { flow?: { steps?: unknown } })?.flow?.steps
				return Array.isArray(steps) && steps.length >= 1
			},
		},
		fields: [halfWidth(composedButtons.prev), halfWidth(composedButtons.next)],
	}

	// Poll lifecycle config; identifiers and behavior, never localized. Lives inside the conditional
	// Poll tab (gated on the top-level `pollEnabled` flag), so the per-field enabled conditions are
	// gone; `label: false` suppresses the group header the tab label already provides.
	// `resultsVisibility` is defaulted and not clearable rather than `required` for the same
	// generated-types reason as `response.type`.
	const pollGroupField: Field = {
		name: 'poll',
		type: 'group',
		label: false,
		fields: [
			// Authored by picking from the form's poll-eligible fields; the stored value stays a plain
			// text field name. Select options and server validate share `pollResultsTypes`, so they
			// cannot drift.
			{
				name: 'resultsField',
				type: 'text',
				label: labelForKey(keys.pollResultsField),
				validate: buildValidateResultsField(pollResultsTypes),
				admin: {
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
			// How the winning value(s) get decided. `mostVoted` (default) and `source` auto-resolve on close
			// (via the scheduled job or the results-read fallback); `manual` leaves it to an admin. Options
			// come from the registered `poll.types` strategies, so a host strategy appears here too, with
			// `mostVoted` first so an enabled poll works with no winner to hand-pick.
			{
				name: 'type',
				type: 'select',
				defaultValue: 'mostVoted',
				label: labelForKey(keys.pollType),
				admin: { isClearable: false, description: labelForKey(keys.pollTypeDescription) },
				options: orderedPollTypes
					.filter((strategy) => strategy.type !== 'source' || hasOptionSources)
					.map((strategy) => ({
						label: resolveDefinitionLabel(strategy.label),
						value: strategy.type,
					})),
			},
			{
				name: 'resultsVisibility',
				type: 'select',
				defaultValue: 'afterVote',
				label: labelForKey(keys.pollResultsVisibility),
				admin: { isClearable: false },
				options: [
					{ label: labelForKey(keys.pollVisibilityAfterVote), value: 'afterVote' },
					{ label: labelForKey(keys.pollVisibilityAfterClose), value: 'afterClose' },
				],
			},
			{
				name: 'closesAt',
				type: 'date',
				label: labelForKey(keys.pollClosesAt),
				admin: { date: { pickerAppearance: 'dayAndTime' } },
			},
			// Close / reopen the poll from the admin. The button toggles on the live `closesAt` and saves the
			// whole document (persisting an unsaved winner alongside `closesAt`) rather than calling the close
			// endpoint, so there is no DB-vs-form-state mismatch. Always mounted inside the (pollEnabled-gated)
			// Poll tab now; the button owns both states, so it carries no `admin.condition` of its own.
			{
				name: 'closePoll',
				type: 'ui',
				admin: {
					components: { Field: CLOSE_POLL_BUTTON_REF },
				},
			},
			...buildPollOptionSourceFields(pollSourceRegistry ?? new Map()),
			// `winningValues` is recorded either by an admin picking from the poll's effective options
			// (served by `/:id/poll-options`) or by `resolvePollOutcome` (host domain logic); more than
			// one value records a tie. The `pollOutcomeBeforeChange` hook validates both paths and owns
			// the `resolvedAt` stamp. `resolvedAt` itself stays fully locked: field-level create/update
			// access blocks every non-override caller write (Payload silently drops the denied value
			// rather than erroring) while the hook's stamp, applied after access filtering, still
			// persists. The `poll.outcomeFields` seam receives both defaults and its return becomes the
			// group's fields verbatim, so a host can swap `winningValues` for its own component; the hook
			// still validates every stored value against the effective options, so no swap bypasses it.
			// `hideGutter` stays: outcome is still a group nested inside the poll group.
			{
				name: 'outcome',
				type: 'group',
				label: labelForKey(keys.pollOutcome),
				admin: { hideGutter: true },
				fields: outcomeFields
					? outcomeFields({ defaultFields: defaultOutcomeFields })
					: [defaultOutcomeFields.winningValues, defaultOutcomeFields.resolvedAt],
			},
		],
	}

	const defaultFields: Field[] = [
		// The document title is the only visitor-facing text the collection renders itself: it is
		// always required (drives `useAsTitle` in the admin list/relationship views) and is passed
		// through `toFormDocument` as `FormDocument.title`. Whether and how a host renders it above
		// the fields is entirely the host's call; the plugin does not gate or duplicate it.
		{
			name: 'title',
			type: 'text',
			label: labelForKey(keys.fieldTitle),
			// Visitor-facing content, so it follows `localizeContent` like the response message and
			// consent statement: hosts with localization get a per-locale title (and a locale-aware
			// `useAsTitle`), hosts without it are unaffected since Payload strips the flag. `validate`
			// (not `required`) keeps it mandatory only in the default locale so other locales fall back.
			...localizedIf(localizeContent),
			validate: validateFormTitle,
		},
		// The three form-level flags: behavior, never localized, sidebar checkboxes by default.
		// `multistep` gates the Flow tab and the client's step navigation; `pollEnabled` gates the
		// Poll tab and marks the form a poll; `persistSubmissions` (default checked) tells the plugin
		// whether to keep a submission's row after its actions run, or prune it. The `settings.fields`
		// seam composes them from the localized defaults, mirroring `buttons.fields`.
		...composeSettingsFields(settings),
		// Unnamed tabs are presentational: their fields stay at the document root. An unnamed tab's
		// `admin.condition` receives the whole document as its 2nd arg, so the Flow and Poll tabs gate
		// on the root-level flags. The poll group nests its config under `form.poll` as before.
		{
			type: 'tabs',
			tabs: [
				{ label: labelForKey(keys.tabFields), fields: [fieldsField, submitField] },
				{
					label: labelForKey(keys.tabFlow),
					admin: { condition: (_data, siblingData) => siblingData?.multistep === true },
					fields: [flowField, prevNextRow],
				},
				{
					label: labelForKey(keys.pollGroup),
					admin: { condition: (_data, siblingData) => siblingData?.pollEnabled === true },
					fields: [pollGroupField],
				},
				{ label: labelForKey(keys.tabActions), fields: [actionsField] },
				{ label: labelForKey(keys.tabResponse), fields: [responseField] },
			],
		},
	]

	// When `consent.sources` is set, resolve the visitor-facing consent statements onto every read of
	// a form doc (REST, local API, relationship population), so a client/modal fetch renders consent,
	// not only the RSC path that calls `resolveConsentStatements` itself. Fails open: a resolver outage
	// must never break form/admin/relationship reads, and the renderer already tolerates a missing
	// statement. `resolveConsentStatements` returns `{}` without calling the resolver when the form has
	// no consent fields, and entries are cached per request+form, so the cost stays bounded.
	const consentAfterRead: CollectionAfterReadHook | undefined =
		consentSources && consentResolveOnRead !== false
			? async ({ doc, req }) => {
					const id = (doc as { id?: unknown }).id
					const key = id == null ? undefined : String(id)
					// Re-entrance guard: a host resolver that reads this same form back (threading req) would
					// otherwise re-enter this hook and recurse. Payload runs collection afterRead concurrently
					// across list docs on one shared req.context, so this must be a per-id Set (a boolean would
					// make sibling docs skip), mutated in place and never reassigned after fan-out. Mirrors
					// @payloadcms/plugin-search's syncDocAsSearchIndex guard.
					if (key !== undefined && req.context) {
						const inFlight =
							(req.context[CONSENT_AFTER_READ_GUARD] as Set<string> | undefined) ??
							new Set<string>()
						if (inFlight.has(key)) {
							return doc
						}
						inFlight.add(key)
						req.context[CONSENT_AFTER_READ_GUARD] = inFlight
					}
					try {
						const statements = await resolveConsentStatements({
							payload: req.payload,
							req,
							form: doc,
							sources: consentSources,
						})
						if (Object.keys(statements).length > 0) {
							;(doc as Record<string, unknown>).consentStatements = statements
						}
					} catch (error) {
						req.payload.logger?.warn(`form-builder consent afterRead: ${String(error)}`)
					} finally {
						if (key !== undefined && req.context) {
							;(req.context[CONSENT_AFTER_READ_GUARD] as Set<string> | undefined)?.delete(key)
						}
					}
					return doc
				}
			: undefined

	const defaultEndpoints = buildFormsEndpoints({
		resultsAccess,
		pollResultsTypes,
		consentSources,
		fromAddresses,
		departments,
	})

	return {
		...(overrides ?? {}),
		slug: FORMS_SLUG,
		labels: {
			singular: labelForKey(keys.collectionFormSingular),
			plural: labelForKey(keys.collectionFormPlural),
			...(overrides?.labels ?? {}),
		},
		admin: {
			group: 'Forms',
			useAsTitle: 'title',
			defaultColumns: ['title', 'fields', 'flow', 'pollEnabled', 'updatedAt'],
			...(overrides?.admin ?? {}),
		},
		access: { read: () => true, ...(overrides?.access ?? {}) },
		hooks: {
			...(overrides?.hooks ?? {}),
			// beforeValidate normalizes conditions and flow; consumer hooks run after
			beforeValidate: [beforeValidate, ...(overrides?.hooks?.beforeValidate ?? [])],
			beforeChange: [pollOutcomeBeforeChange, ...(overrides?.hooks?.beforeChange ?? [])],
			afterChange: [pollCloseAfterChange, ...(overrides?.hooks?.afterChange ?? [])],
			afterRead: [
				...(consentAfterRead ? [consentAfterRead] : []),
				...(overrides?.hooks?.afterRead ?? []),
			],
		},
		endpoints: [
			...defaultEndpoints,
			...(Array.isArray(overrides?.endpoints) ? overrides.endpoints : []),
		],
		fields: overrides?.fields ? overrides.fields({ defaultFields }) : defaultFields,
	}
}
