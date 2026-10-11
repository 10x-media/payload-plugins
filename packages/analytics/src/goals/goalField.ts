import type { LabelFunction, StaticLabel, TextField, TextFieldSingleValidation } from 'payload'
import { isRecord } from '../core/values'
import { keys } from '../translations/keys'
import { asTranslate, labelForKey } from '../translations/server'
import { GOAL_SLUG_PATTERN } from './types'

/** importMap path of the picker; the factory never imports the component itself. */
export const GOAL_FIELD_COMPONENT = '@10x-media/analytics/rsc#GoalSelectFieldServer'

export interface GoalFieldOptions {
	/** Field name, and therefore the property the slug is stored under. Default `'goal'`. */
	name?: string
	/** Default: the translated "Goal". */
	label?: LabelFunction | StaticLabel
	required?: boolean
	/** Merged over the factory's own admin config; the Field component is not replaceable here. */
	admin?: TextField['admin']
	/** Last word on the built field. Spread the field, never deep-merge it. */
	overrides?: (args: { field: TextField }) => TextField
}

const makeValidate =
	(required: boolean): TextFieldSingleValidation =>
	(value, { req }) => {
		const slug = typeof value === 'string' ? value.trim() : ''
		if (slug === '') {
			return required ? req.t('validation:required') : true
		}
		return GOAL_SLUG_PATTERN.test(slug) ? true : asTranslate(req.t)(keys.fieldGoalInvalid)
	}

/**
 * A goal picker for any collection or global, storing the slug of a goal visible to the requesting
 * scope. Read the stored value back with {@link goalSlug}.
 */
export const goalField = (options: GoalFieldOptions = {}): TextField => {
	const field: TextField = {
		name: options.name ?? 'goal',
		type: 'text',
		label: options.label ?? labelForKey(keys.fieldGoalLabel),
		...(options.required ? { required: true } : {}),
		validate: makeValidate(Boolean(options.required)),
		admin: {
			...options.admin,
			components: {
				...options.admin?.components,
				Field: { path: GOAL_FIELD_COMPONENT },
			},
		},
	}
	return options.overrides ? options.overrides({ field }) : field
}

/**
 * The slug from a stored {@link goalField} value, string or populated `{ slug }`; anything else is
 * null rather than a guess.
 */
export const goalSlug = (value: unknown): string | null => {
	const raw = isRecord(value) && !Array.isArray(value) ? value.slug : value
	const slug = typeof raw === 'string' ? raw.trim() : ''
	return slug === '' ? null : slug
}
