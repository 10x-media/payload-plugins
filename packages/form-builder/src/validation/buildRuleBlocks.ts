import type { Block, Field } from 'payload'
import { keys } from '../translations/keys'
import { labelFor } from '../translations/server'
import type { ValidationRuleRegistry } from './registry'

const RULE_DESCRIPTION_REF = '@10x-media/form-builder/client#RuleDescription'

/** Each rule block appends its own `message` field, so a rule param of that name would collide and be silently dropped by Payload. */
const RESERVED_PARAM_NAMES = new Set(['message'])

/**
 * One block per rule applicable to `fieldType` (gated by `appliesTo`): a leading plain-language
 * description (when the rule sets one), the rule params, then a message override. The description is
 * a `ui` field mounting `RuleDescription`, because Payload `Block`s have no native description slot.
 */
export const buildRuleBlocks = (registry: ValidationRuleRegistry, fieldType: string): Block[] => {
	const blocks: Block[] = []
	for (const rule of registry.values()) {
		if (rule.appliesTo && !rule.appliesTo.includes(fieldType)) {
			continue
		}
		for (const param of rule.params ?? []) {
			if ('name' in param && RESERVED_PARAM_NAMES.has(param.name)) {
				throw new Error(
					`form-builder: validation rule "${rule.type}" declares a reserved param name "${param.name}". The name "message" is reserved for the constraint-list UI.`
				)
			}
		}
		const descriptionField: Field[] = rule.description
			? [
					{
						name: `${rule.type}Description`,
						type: 'ui',
						admin: {
							components: {
								Field: {
									path: RULE_DESCRIPTION_REF,
									clientProps: { descriptionKey: rule.description },
								},
							},
						},
					},
				]
			: []
		blocks.push({
			slug: rule.type,
			labels: { singular: labelFor(rule.label), plural: labelFor(rule.label) },
			fields: [
				...descriptionField,
				...(rule.params ?? []),
				{ name: 'message', type: 'text', label: labelFor(keys.validationMessageLabel) },
			],
		})
	}
	return blocks
}
