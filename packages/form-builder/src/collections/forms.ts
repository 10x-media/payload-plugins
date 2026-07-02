import type { CollectionBeforeValidateHook, CollectionConfig, PayloadRequest } from 'payload'
import { buildActionBlocks } from '../actions/buildActionBlocks'
import type { ActionRegistry } from '../actions/registry'
import { resolveFormResultsRequest } from '../aggregation/resolveResultsRequest'
import { normalizeCalc } from '../calc/normalizeCalc'
import { buildConditionTypeMap } from '../conditions/conditionType'
import { type FieldRow, normalizeFormConditions } from '../conditions/normalizeConditions'
import { buildFieldBlocks } from '../fields/buildFieldBlocks'
import type { FieldTypeRegistry } from '../fields/registry'
import { normalizeFlow } from '../flow/normalizeFlow'
import { isLoggedIn } from '../plugin/access'
import {
	DEFAULT_PRESENTATION_NAME,
	defaultPresentationDescriptors,
} from '../presentations/defaults'
import type { PresentationDescriptorRegistry } from '../presentations/registry'
import { keys } from '../translations/keys'
import { labelFor, labelForKey } from '../translations/server'
import type { ValidationRuleRegistry } from '../validation/registry'

export const FORMS_SLUG = 'forms'

type BuildFormsCollectionArgs = {
	registry: FieldTypeRegistry
	ruleRegistry: ValidationRuleRegistry
	presentationRegistry?: PresentationDescriptorRegistry
	actionRegistry?: ActionRegistry
}

export const buildFormsCollection = ({
	registry,
	ruleRegistry,
	presentationRegistry = new Map(Object.entries(defaultPresentationDescriptors)),
	actionRegistry = new Map(),
}: BuildFormsCollectionArgs): CollectionConfig => {
	const conditionTypes = buildConditionTypeMap(registry)

	const beforeValidate: CollectionBeforeValidateHook = ({ data }) => {
		if (
			data &&
			typeof data.defaultPresentation === 'string' &&
			!presentationRegistry.has(data.defaultPresentation)
		) {
			data.defaultPresentation = DEFAULT_PRESENTATION_NAME
		}
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
			data.fields = normalized
			const fieldNames = normalized
				.map((field: FieldRow) => (typeof field.name === 'string' ? field.name : undefined))
				.filter((name): name is string => name !== undefined)
			data.flow = normalizeFlow(data.flow, fieldNames)
		}
		return data
	}

	return {
		slug: FORMS_SLUG,
		labels: { singular: 'Form', plural: 'Forms' },
		admin: { group: 'Forms', useAsTitle: 'title' },
		access: { read: () => true },
		hooks: {
			beforeValidate: [beforeValidate],
		},
		fields: [
			{ name: 'title', type: 'text', required: true, label: labelForKey(keys.fieldTitle) },
			{ name: 'fields', type: 'blocks', blocks: buildFieldBlocks(registry, ruleRegistry) },
			{
				name: 'flow',
				type: 'json',
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
			},
			{
				name: 'actions',
				type: 'blocks',
				blocks: buildActionBlocks(actionRegistry),
				label: labelForKey(keys.configActions),
				// Action config can contain secrets (e.g. signedWebhook.secret). The collection
				// itself is publicly readable so forms can be rendered by anonymous clients, but
				// action config must never be exposed to anonymous callers.
				access: { read: isLoggedIn },
			},
			{
				name: 'defaultPresentation',
				type: 'select',
				defaultValue: DEFAULT_PRESENTATION_NAME,
				options: [...presentationRegistry.values()].map((descriptor) => ({
					label: labelFor(descriptor.label),
					value: descriptor.name,
				})),
				label: labelForKey(keys.configDefaultPresentation),
				admin: { position: 'sidebar' },
			},
			{
				name: 'showResults',
				type: 'checkbox',
				defaultValue: false,
				label: labelForKey(keys.configShowResults),
				admin: { position: 'sidebar' },
			},
			{
				name: 'resultsField',
				type: 'text',
				label: labelForKey(keys.configResultsField),
				admin: {
					position: 'sidebar',
					description:
						'Field whose aggregate results are public when "Show results publicly" is on. Use a choice field, never a free-text or PII field.',
					condition: (data) => Boolean(data?.showResults),
				},
			},
		],
		endpoints: [
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
					})
					return Response.json(body, { status })
				},
			},
		],
	}
}
