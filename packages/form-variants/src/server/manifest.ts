import { getTranslation, type I18nClient } from '@payloadcms/translations'
import type { LabelFunction } from 'payload'

import type { ClientFieldItem, ClientStep, ClientVariant } from '../client/types'
import type { ResolvedFieldItem, ResolvedVariant } from '../plugin/registry'
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

/**
 * Key of a component step or item in the provider's `rendered` map. `itemIndex` is the item's
 * position, dotted once containers nest it, so a component keeps one key wherever it sits.
 */
export const renderedKey = (
	variantKey: string,
	stepKey: string,
	itemIndex?: number | string
): string =>
	itemIndex === undefined ? `${variantKey}/${stepKey}` : `${variantKey}/${stepKey}/${itemIndex}`

/** The index path of one item, the way `renderedKey` and the render walk both address it. */
export const itemIndexPath = (prefix: string, index: number): string =>
	prefix === '' ? String(index) : `${prefix}.${index}`

const buildItems = (
	items: ResolvedFieldItem[],
	args: { i18n: I18nClient; prefix: string; stepKey: string; variantKey: string }
): ClientFieldItem[] =>
	items.map((item, index): ClientFieldItem => {
		const at = itemIndexPath(args.prefix, index)
		const nested = (): ClientFieldItem[] =>
			buildItems((item as { items: ResolvedFieldItem[] }).items, { ...args, prefix: at })
		switch (item.type) {
			case 'collapsible':
				return {
					initCollapsed: item.initCollapsed,
					items: nested(),
					label: translate(item.label, args.i18n) ?? '',
					type: 'collapsible',
				}
			case 'component':
				return { id: renderedKey(args.variantKey, args.stepKey, at), type: 'component' }
			case 'group':
				return {
					description: translate(item.description, args.i18n),
					items: nested(),
					label: translate(item.label, args.i18n),
					type: 'group',
				}
			case 'row':
				return { items: nested(), type: 'row' }
			default:
				return {
					admin: item.admin,
					description: translate(item.description, args.i18n),
					label: translate(item.label, args.i18n),
					path: item.path,
					type: 'field',
				}
		}
	})

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
			items: buildItems(step.items, {
				i18n: args.i18n,
				prefix: '',
				stepKey: step.key,
				variantKey: variant.key,
			}),
			key: step.key,
			kind: step.kind,
			label: translate(step.label, args.i18n),
		})
	),
	ui: variant.ui,
})
