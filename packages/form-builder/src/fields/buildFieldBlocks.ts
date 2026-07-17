import type { Block, Field, TabsField } from 'payload'
import { buildConditionTypeMap } from '../conditions/conditionType'
import { keys } from '../translations/keys'
import { labelFor } from '../translations/server'
import { buildRuleBlocks } from '../validation/buildRuleBlocks'
import type { ValidationRuleRegistry } from '../validation/registry'
import type { FieldTypeRegistry } from './registry'
import { fieldBlockTabs } from './sharedConfig'

/** Whether `fields` contains a field named `name`, descending into presentational rows. */
const hasNameField = (fields: Field[]): boolean =>
	fields.some((f) => {
		if ('name' in f && f.name === 'name') {
			return true
		}
		return f.type === 'row' && hasNameField(f.fields)
	})

/** The tab whose fields hold the shared basics and type config, found by the `name` field it carries. */
const fieldTabOf = (block: Block): Field[] | undefined => {
	const tabsField = block.fields.find((f): f is TabsField => f.type === 'tabs')
	return tabsField?.tabs.find((tab) => hasNameField(tab.fields))?.fields
}

/**
 * One add-field block per registered type: tabs holding shared config, type config, and
 * validations. Bare definitions (e.g. `message`) skip all of that: their block is the
 * definition's `config` alone, no name/shared basics/tabs. `localize` controls whether the
 * shared content fields carry `localized: true`; per-type config fields carry their own flag
 * from the registry definitions.
 */
type BuildFieldBlocksArgs = {
	registry: FieldTypeRegistry
	ruleRegistry: ValidationRuleRegistry
	localize?: boolean
}

export const buildFieldBlocks = ({
	registry,
	ruleRegistry,
	localize = true,
}: BuildFieldBlocksArgs): Block[] => {
	const conditionTypes = buildConditionTypeMap(registry)
	const blocks: Block[] = []
	const bareSlugs = new Set<string>()
	for (const definition of registry.values()) {
		const typeConfig: Field[] = definition.config ?? []

		if (definition.bare === true) {
			bareSlugs.add(definition.type)
			blocks.push({
				slug: definition.type,
				labels: { singular: labelFor(definition.label), plural: labelFor(definition.label) },
				fields: typeConfig,
			})
			continue
		}

		blocks.push({
			slug: definition.type,
			labels: { singular: labelFor(definition.label), plural: labelFor(definition.label) },
			fields: [
				fieldBlockTabs({
					conditionTypes,
					typeConfig,
					validations: {
						name: 'validations',
						type: 'blocks',
						label: labelFor(keys.validationsLabel),
						blocks: buildRuleBlocks(ruleRegistry, definition.type),
					},
					localize,
					omitShared: definition.omitShared,
				}),
			],
		})
	}

	// Second pass: inject subFields into the repeater block using all non-repeater blocks.
	// Done after the main loop so every sibling block is already built.
	// Repeater-in-repeater is not supported in v1; the repeater block is excluded from subFields.
	// Bare blocks are excluded too: repeater row plumbing (values, composite error paths) is name-keyed.
	const repeaterBlock = blocks.find((b) => b.slug === 'repeater')
	if (repeaterBlock) {
		const subFieldsField: Field = {
			name: 'subFields',
			type: 'blocks',
			label: labelFor(keys.configSubFields),
			blocks: blocks.filter((b) => b.slug !== 'repeater' && !bareSlugs.has(b.slug)),
		}
		const fieldTabFields = fieldTabOf(repeaterBlock)
		;(fieldTabFields ?? (repeaterBlock.fields as Field[])).push(subFieldsField)
	}

	return blocks
}
