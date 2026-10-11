import type { NumberField } from 'payload'

/** importMap path of the Amount control; the factories never import the component itself. */
export const GOAL_AMOUNT_FIELD_COMPONENT = '@10x-media/analytics/client#GoalAmountField'

/**
 * What the Amount control reads beside its field config, handed over as `clientProps`.
 *
 * @internal
 */
export interface GoalAmountFieldOptions {
	/**
	 * The currency field, relative to the amount's own parent: a plain name is a sibling of the
	 * amount, and each leading `../` climbs out of one enclosing group.
	 */
	currencyPath: string
	/** Filled in once an amount is set while no currency is stored. */
	defaultCurrency?: string
}

/**
 * A number field drawn as the Amount control, with a picker for the currency at `currencyPath`. The
 * currency keeps its own field, so the stored shape is unchanged. A blank `defaultCurrency` is none.
 */
export const amountField = (
	field: NumberField,
	{ currencyPath, defaultCurrency }: GoalAmountFieldOptions
): NumberField => ({
	...field,
	admin: {
		...field.admin,
		components: {
			...field.admin?.components,
			Field: {
				path: GOAL_AMOUNT_FIELD_COMPONENT,
				clientProps: { currencyPath, ...(defaultCurrency ? { defaultCurrency } : {}) },
			},
		},
	},
})

/** The full path of the field `relative` names, seen from the field at `from`. */
export const siblingPath = (from: string, relative: string): string => {
	const segments = from.split('.').slice(0, -1)
	let rest = relative
	while (rest.startsWith('../')) {
		segments.pop()
		rest = rest.slice(3)
	}
	return [...segments, rest].filter(Boolean).join('.')
}
