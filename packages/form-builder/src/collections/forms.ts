import type { CollectionBeforeValidateHook, CollectionConfig } from 'payload'
import { buildActionBlocks } from '../actions/buildActionBlocks'
import type { ActionRegistry } from '../actions/registry'
import { normalizeCalc } from '../calc/normalizeCalc'
import { buildConditionTypeMap } from '../conditions/conditionType'
import { type FieldRow, normalizeFormConditions } from '../conditions/normalizeConditions'
import { buildFieldBlocks } from '../fields/buildFieldBlocks'
import type { FieldTypeRegistry } from '../fields/registry'
import { normalizeFlow } from '../flow/normalizeFlow'
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
			{ name: 'flow', type: 'json' },
			{
				name: 'actions',
				type: 'blocks',
				blocks: buildActionBlocks(actionRegistry),
				label: labelForKey(keys.configActions),
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
		],
	}
}
