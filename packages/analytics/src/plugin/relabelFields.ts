import type { Config, Field } from 'payload'
import { isRecord } from '../core/values'
import { builtInLabelKey, type StaticLabelFor } from '../translations/staticLabel'
import { walkFields } from './walkFields'

/** Swaps a built-in static label held at `target[key]` for the install's own strings. */
const relabelAt = (target: object, key: string, staticLabel: StaticLabelFor): void => {
	const builtIn = builtInLabelKey(Reflect.get(target, key))
	if (builtIn !== undefined) {
		Object.assign(target, { [key]: staticLabel(builtIn) })
	}
}

const relabelField = (field: Field, staticLabel: StaticLabelFor): void => {
	relabelAt(field, 'label', staticLabel)
	const admin: unknown = 'admin' in field ? field.admin : undefined
	if (isRecord(admin)) {
		relabelAt(admin, 'description', staticLabel)
		relabelAt(admin, 'placeholder', staticLabel)
	}
	if ('options' in field && Array.isArray(field.options)) {
		for (const option of field.options) {
			if (isRecord(option)) {
				relabelAt(option, 'label', staticLabel)
			}
		}
	}
}

/**
 * Field factories run before the plugin sees its `translations` option, so their static labels hold
 * built-in strings. This swaps each for the install's own across collections, globals and blocks.
 */
export const relabelFactoryFields = (config: Config, staticLabel: StaticLabelFor): void => {
	const relabel = (fields: Field[]): void => {
		for (const field of walkFields(fields)) {
			relabelField(field, staticLabel)
		}
	}
	for (const collection of config.collections ?? []) relabel(collection.fields)
	for (const global of config.globals ?? []) relabel(global.fields)
	for (const block of config.blocks ?? []) relabel(block.fields)
}
