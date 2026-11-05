import type { Field, NumberField } from 'payload'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import { type GoalFieldOptions, goalField } from './goalField'
import { applyRevenueVisibility, moneyField } from './moneyFields'

export interface AnalyticsLinkFieldsOptions {
	/** Passed straight to {@link goalField}; `name` defaults to `'goal'`. */
	goal?: GoalFieldOptions
	/**
	 * A per-link worth beside the picker, off by default. Native still prefers a goal's fixed value
	 * unless `revenue.browserAmounts` is `'trust'`.
	 */
	value?: boolean | { name?: string; overrides?: (args: { field: NumberField }) => NumberField }
	/** Last word on the whole set. Return the fields to use, in the order to use them. */
	overrides?: (args: { fields: Field[] }) => Field[]
	/**
	 * Whether the value input is offered. Set it to match your `revenue` option inside a Lexical
	 * `LinkFeature`, whose fields the plugin cannot see to hide.
	 */
	revenue?: boolean
}

/**
 * The analytics fields for a link: a goal picker and optional worth, for your link group or a
 * `LinkFeature`'s `fields`. Read them back with `goalAttributes()` where the link renders.
 */
export const analyticsLinkFields = (options: AnalyticsLinkFieldsOptions = {}): Field[] => {
	const fields: Field[] = [goalField(options.goal)]
	if (options.value) {
		const config = options.value === true ? {} : options.value
		const field: NumberField = moneyField({
			name: config.name ?? 'goalValue',
			type: 'number',
			min: 0,
			label: labelForKey(keys.fieldGoalValueLabel),
			admin: {
				description: labelForKey(keys.fieldGoalValueHelp),
				condition: (_data, siblingData) => Boolean(siblingData?.[options.goal?.name ?? 'goal']),
			},
		})
		fields.push(config.overrides ? config.overrides({ field }) : field)
	}
	const resolved = options.overrides ? options.overrides({ fields }) : fields
	return applyRevenueVisibility(resolved, options.revenue ?? true)
}
