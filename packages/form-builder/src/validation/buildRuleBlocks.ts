import type { Block } from 'payload'
import { keys } from '../translations/keys'
import { labelFor } from '../translations/server'
import type { ValidationRuleRegistry } from './registry'

/** Each rule block appends its own `message` field, so a rule param of that name would collide and be silently dropped by Payload. */
const RESERVED_PARAM_NAMES = new Set(['message'])

/** One block per rule applicable to `fieldType` (gated by `appliesTo`): the rule params, then a message override. */
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
		blocks.push({
			slug: rule.type,
			labels: { singular: labelFor(rule.label), plural: labelFor(rule.label) },
			fields: [
				...(rule.params ?? []),
				{ name: 'message', type: 'text', label: labelFor(keys.validationMessageLabel) },
			],
		})
	}
	return blocks
}
