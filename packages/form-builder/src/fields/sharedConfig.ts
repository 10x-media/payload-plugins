import type { Field } from 'payload'
import type { ConditionFieldType } from '../conditions/fieldTypes'
import { keys } from '../translations/keys'
import { labelFor } from '../translations/server'
import { localizedIf } from './localizedIf'
import type { OmittableSharedField } from './types'

const CONDITION_FIELD_REF = '@10x-media/form-builder/client#FormConditionField'

const conditionField = (
	name: 'visibleWhen' | 'validateWhen',
	labelKey: string,
	conditionTypes: Record<string, ConditionFieldType>
): Field => ({
	name,
	type: 'json',
	label: labelFor(labelKey),
	admin: {
		components: {
			Field: { path: CONDITION_FIELD_REF, clientProps: { conditionTypes } },
		},
	},
})

/**
 * Let a lone row survivor span its row: Payload styles a row child with no `admin.width` as
 * `flex: 1 1 auto` (see `mergeFieldStyles`), so dropping the key is the "fill the row" signal.
 * Without this, omitting one half of a 50/50 row would strand the other half at 50%.
 */
const spanRow = <T extends Field>(field: T): T => {
	if (field.admin?.width === undefined) {
		return field
	}
	const { width: _width, ...admin } = field.admin
	return { ...field, admin }
}

/**
 * Drop the shared fields a type never uses, descending into the presentational rows so a nested
 * field is reachable. An emptied row is dropped whole; a row pruned down to one field lets that
 * field span it. A row that lost nothing is left exactly as authored, single-child rows included.
 */
const applyOmissions = (fields: Field[], omit: ReadonlySet<string>): Field[] =>
	fields.flatMap((field): Field[] => {
		if (field.type === 'row') {
			const kept = applyOmissions(field.fields, omit)
			if (kept.length === 0) {
				return []
			}
			const strandsSurvivor = kept.length === 1 && kept.length < field.fields.length
			return [{ ...field, fields: strandsSurvivor ? kept.map(spanRow) : kept }]
		}
		return 'name' in field && omit.has(field.name) ? [] : [field]
	})

/** The full shared config, before a type's `omitShared` prunes it. See `sharedFieldConfig`. */
const baseSharedFieldConfig = (localize: boolean): Field[] => [
	{
		type: 'row',
		fields: [
			{
				name: 'name',
				type: 'text',
				required: true,
				label: labelFor(keys.configName),
				admin: { width: '50%' },
			},
			{
				name: 'label',
				type: 'text',
				label: labelFor(keys.configLabel),
				admin: { width: '50%' },
				...localizedIf(localize),
			},
		],
	},
	{
		type: 'row',
		fields: [
			{
				name: 'width',
				type: 'select',
				defaultValue: 'full',
				label: labelFor(keys.configWidth),
				admin: { width: '50%', isClearable: false },
				options: [
					{ label: labelFor(keys.widthFull), value: 'full' },
					{ label: labelFor(keys.widthHalf), value: 'half' },
					{ label: labelFor(keys.widthThird), value: 'third' },
					{ label: labelFor(keys.widthTwoThirds), value: 'twoThirds' },
				],
			},
			{
				name: 'placeholder',
				type: 'text',
				label: labelFor(keys.configPlaceholder),
				admin: { width: '50%' },
				...localizedIf(localize),
			},
		],
	},
	{
		name: 'description',
		type: 'textarea',
		label: labelFor(keys.configDescription),
		...localizedIf(localize),
	},
	{ name: 'required', type: 'checkbox', label: labelFor(keys.configRequired) },
]

/**
 * Config every field instance carries regardless of type. `name` is the machine key written into
 * submissions; `width` is stored for the layout grid. Field types add their own `config` after
 * these inside the Field tab (see `fieldBlockTabs`) and drop the ones they never read via
 * `omitShared`, so an author is never offered a setting the renderer ignores. Content-bearing
 * fields (`label`, `placeholder`, `description`) are localized unless `localize` is false;
 * identifiers and behavior flags never are. The rows are presentational only (unnamed, data paths
 * stay flat); `required` sits last, under `description`, per the admin layout.
 */
export const sharedFieldConfig = (
	localize = true,
	omitShared: readonly OmittableSharedField[] = []
): Field[] => {
	const omit = new Set<string>(omitShared)
	// `name` is the storage key every read and write path gates on (`isNamedField`). The type
	// already excludes it; dropping it here too keeps an untyped caller from breaking storage.
	omit.delete('name')
	return applyOmissions(baseSharedFieldConfig(localize), omit)
}

/**
 * The single field of every field block: unnamed tabs (presentational only, data paths stay flat).
 * Field tab holds the shared basics plus the type's own config; Validation holds the rule blocks and
 * `validateWhen`; Advanced holds `visibleWhen` and `hidden`. `visibleWhen`/`validateWhen` store a
 * canonical Payload `Where`, edited by the native condition builder.
 */
type FieldBlockTabsArgs = {
	conditionTypes: Record<string, ConditionFieldType>
	typeConfig: Field[]
	validations: Field
	localize?: boolean
	/** See `FormFieldDefinition.omitShared`: shared basics this type never uses, left unauthored. */
	omitShared?: readonly OmittableSharedField[]
	/** See `FormFieldDefinition.advancedConfig`: extra fields appended to the Advanced tab. */
	advancedConfig?: Field[]
}

export const fieldBlockTabs = ({
	conditionTypes,
	typeConfig,
	validations,
	localize = true,
	omitShared,
	advancedConfig,
}: FieldBlockTabsArgs): Field => ({
	type: 'tabs',
	tabs: [
		{
			label: labelFor(keys.tabField),
			fields: [...sharedFieldConfig(localize, omitShared), ...typeConfig],
		},
		{
			label: labelFor(keys.tabValidation),
			fields: [
				validations,
				conditionField('validateWhen', keys.configValidateWhen, conditionTypes),
			],
		},
		{
			label: labelFor(keys.tabAdvanced),
			fields: [
				conditionField('visibleWhen', keys.configVisibleWhen, conditionTypes),
				{
					name: 'hidden',
					type: 'checkbox',
					label: labelFor(keys.configHidden),
					admin: { description: labelFor(keys.configHiddenDescription) },
				},
				...(advancedConfig ?? []),
			],
		},
	],
})
