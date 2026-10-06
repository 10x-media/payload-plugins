import type { LabelFunction, StaticLabel, TextField, TextFieldSingleValidation } from 'payload'
import { keys } from '../translations/keys'
import { asTranslate, labelForKey } from '../translations/server'
import { GOAL_SLUG_PATTERN } from './types'

/** importMap path of the picker; the factory never imports the component itself. */
export const GOAL_FIELD_COMPONENT = '@10x-media/analytics/client#GoalSelectField'

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
 * A goal picker for any collection or global: a text field storing the goal slug, rendered
 * by the client picker that lists the config goals merged with the goals collection for the
 * requesting scope. Pair it with {@link goalSlug} wherever the stored value is read back.
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
 * The slug out of a stored goal value, for renderers that read a {@link goalField} back.
 * Accepts the stored string and the `{ slug }` shape a populated document carries; anything
 * else is not a goal reference and resolves to null rather than a guess.
 */
export const goalSlug = (value: unknown): string | null => {
	if (typeof value === 'string') {
		const slug = value.trim()
		return slug === '' ? null : slug
	}
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		const { slug } = value as { slug?: unknown }
		if (typeof slug === 'string') {
			const trimmed = slug.trim()
			return trimmed === '' ? null : trimmed
		}
	}
	return null
}
