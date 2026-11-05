import type { Config, Field } from 'payload'
import { isRecord } from '../core/values'
import { walkFields } from '../plugin/walkFields'

/** Namespace this plugin keeps its own field metadata under, inside Payload's `custom`. */
const ANALYTICS_FIELD_CUSTOM = '10x-analytics'

/**
 * Tags a field to hide while the install measures no money. Factories run before the plugin's
 * options resolve, so they tag and {@link applyRevenueVisibility} hides, per Payload instance.
 */
export const moneyField = <T extends Field>(field: T): T => {
	const custom: unknown = field.custom
	return {
		...field,
		custom: { ...(isRecord(custom) ? custom : {}), [ANALYTICS_FIELD_CUSTOM]: { money: true } },
	}
}

const isMoneyField = (field: Field): boolean => {
	const custom: unknown = field.custom
	const tag = isRecord(custom) ? custom[ANALYTICS_FIELD_CUSTOM] : undefined
	return isRecord(tag) && tag.money === true
}

const never = (): boolean => false

/** `field`'s admin config behind a condition no form meets: hidden, yet still in the schema. */
export const hiddenAdmin = (field: Field): Record<string, unknown> => {
	const admin: unknown = field.admin
	return { ...(isRecord(admin) ? admin : {}), condition: never }
}

/**
 * Hides a field tree's money fields while the install measures none. They stay in the schema, so
 * stored amounts survive and show again once money is back on.
 */
export const applyRevenueVisibility = (fields: Field[], money: boolean): Field[] => {
	if (money) {
		return fields
	}
	for (const field of walkFields(fields)) {
		if (isMoneyField(field)) {
			Object.assign(field, { admin: hiddenAdmin(field) })
		}
	}
	return fields
}

/**
 * {@link applyRevenueVisibility} over every field tree a config holds, including the `blocks` it
 * defines once for `blockReferences`.
 */
export const applyConfigRevenueVisibility = (config: Config, money: boolean): void => {
	if (money) {
		return
	}
	for (const collection of config.collections ?? []) {
		applyRevenueVisibility(collection.fields, money)
	}
	for (const global of config.globals ?? []) {
		applyRevenueVisibility(global.fields, money)
	}
	for (const block of config.blocks ?? []) {
		applyRevenueVisibility(block.fields, money)
	}
}
