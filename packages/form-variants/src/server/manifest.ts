import { getTranslation, type I18nClient } from '@payloadcms/translations'
import type { LabelFunction } from 'payload'

import type { ClientFieldItem, ClientStep, ClientVariant } from '../client/types'
import type { ResolvedVariant } from '../plugin/registry'
import type { VariantLabel } from '../types'

/** A label resolved for this request's language; `undefined` stays `undefined`. */
export const translate = (
	label: undefined | VariantLabel,
	i18n: I18nClient
): string | undefined => {
	if (label === undefined) {
		return undefined
	}
	if (typeof label === 'function') {
		return label({ i18n, t: i18n.t } as unknown as Parameters<LabelFunction>[0])
	}
	return String(getTranslation(label, i18n))
}

/** Key of a component step or item in the provider's `rendered` map. */
export const renderedKey = (variantKey: string, stepKey: string, itemIndex?: number): string =>
	itemIndex === undefined ? `${variantKey}/${stepKey}` : `${variantKey}/${stepKey}/${itemIndex}`

/** The serializable half of a variant, with labels resolved and the initial visibility applied. */
export const buildClientVariant = (
	variant: ResolvedVariant,
	args: { i18n: I18nClient; visible: string[] }
): ClientVariant => ({
	hasAfterSave: Boolean(variant.afterSave),
	key: variant.key,
	label: translate(variant.label, args.i18n) ?? variant.key,
	native: variant.native,
	navigation: variant.navigation,
	save: variant.save,
	steps: variant.steps.map(
		(step): ClientStep => ({
			description: translate(step.description, args.i18n),
			hasCondition: Boolean(step.condition),
			hasGate: Boolean(step.gate),
			initiallyVisible: args.visible.includes(step.key),
			items: step.items.map((item, index): ClientFieldItem => {
				if (item.type === 'component') {
					return { id: renderedKey(variant.key, step.key, index), type: 'component' }
				}
				return {
					description: translate(item.description, args.i18n),
					label: translate(item.label, args.i18n),
					path: item.path,
					type: 'field',
				}
			}),
			key: step.key,
			kind: step.kind,
			label: translate(step.label, args.i18n),
		})
	),
	ui: variant.ui,
})
