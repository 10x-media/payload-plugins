import type { Block } from 'payload'
import { keys } from '../translations/keys'
import { labelFor } from '../translations/server'
import type { ValidationRuleRegistry } from './registry'

/** One block per rule applicable to `fieldType` (gated by `appliesTo`): the rule params, then a message override and severity. */
export const buildRuleBlocks = (registry: ValidationRuleRegistry, fieldType: string): Block[] => {
	const blocks: Block[] = []
	for (const rule of registry.values()) {
		if (rule.appliesTo && !rule.appliesTo.includes(fieldType)) {
			continue
		}
		blocks.push({
			slug: rule.type,
			labels: { singular: labelFor(rule.label), plural: labelFor(rule.label) },
			fields: [
				...(rule.params ?? []),
				{ name: 'message', type: 'text', label: labelFor(keys.validationMessageLabel) },
				{
					name: 'severity',
					type: 'select',
					defaultValue: 'error',
					label: labelFor(keys.validationSeverityLabel),
					options: [
						{ label: labelFor(keys.validationSeverityError), value: 'error' },
						{ label: labelFor(keys.validationSeverityWarning), value: 'warning' },
					],
				},
			],
		})
	}
	return blocks
}
