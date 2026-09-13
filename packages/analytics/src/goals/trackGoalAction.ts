import type { Field, Payload, PayloadRequest, TextFieldSingleValidation } from 'payload'
import { AnalyticsTrackError } from '../core/serverEvent'
import { trackServerEvent } from '../native/ingest/serverTrack'
import { de } from '../translations/de'
import { en } from '../translations/en'
import { keys } from '../translations/keys'
import { asTranslate, labelForKey } from '../translations/server'
import { goalField, goalSlug } from './goalField'

/** The action type form-builder stores on a form's `actions` block. */
export const GOAL_ACTION_TYPE = 'analytics-goal'

const CURRENCY_PATTERN = /^[A-Z]{3}$/

/**
 * The run context form-builder hands a post-submit action, narrowed to what goal tracking
 * reads. A structural subset rather than an import: analytics never depends on form-builder
 * at runtime, so an install without it still resolves this module.
 */
export interface GoalActionRunArgs {
	form: { id: number | string; title?: string }
	submissionId: number | string
	/** One entry per answered field, keyed by the field's machine name. */
	values: Array<{ field: string; value: unknown }>
	config: Record<string, unknown>
	payload: Payload
	req?: PayloadRequest
}

/** The validation context form-builder passes when a form carrying this action is saved. */
export interface GoalActionValidateArgs {
	data: Record<string, unknown>
	req: PayloadRequest
}

/**
 * Structural counterpart of form-builder's `ActionDefinition<Record<string, unknown>>`; a
 * value of this type is assignable to it, which `trackGoalAction.test.ts` pins.
 */
export interface GoalActionDefinition {
	type: typeof GOAL_ACTION_TYPE
	label: string | Record<string, string>
	config: Field[]
	validateConfig?: (
		config: Record<string, unknown>,
		ctx: GoalActionValidateArgs
	) => string | true | Promise<string | true>
	run: (args: GoalActionRunArgs) => Promise<void>
}

export interface TrackGoalActionOptions {
	/** Site the completion belongs to. Defaults to the submitting request's host. */
	hostname?: string | ((args: GoalActionRunArgs) => string)
	/** Page the completion is attributed to. Defaults to `/forms/<form id>`. */
	path?: string | ((args: GoalActionRunArgs) => string)
}

const validateCurrency: TextFieldSingleValidation = (value, { req }) =>
	!value || CURRENCY_PATTERN.test(value) ? true : asTranslate(req.t)(keys.goalErrorCurrency)

const configFields = (): Field[] => [
	goalField({ name: 'goal', required: true }),
	{
		name: 'value',
		type: 'number',
		min: 0,
		label: labelForKey(keys.goalFieldValue),
	},
	{
		name: 'valueFrom',
		type: 'text',
		label: labelForKey(keys.actionGoalFieldValueFrom),
		admin: { description: labelForKey(keys.actionGoalFieldValueFromHelp) },
	},
	{
		name: 'currency',
		type: 'text',
		label: labelForKey(keys.goalFieldCurrency),
		validate: validateCurrency,
	},
]

const finiteNumber = (value: unknown): number | undefined => {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : undefined
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value)
		return Number.isFinite(parsed) ? parsed : undefined
	}
	return undefined
}

const nonEmpty = (value: unknown): string | undefined => {
	if (typeof value !== 'string') {
		return undefined
	}
	const trimmed = value.trim()
	return trimmed === '' ? undefined : trimmed
}

const fromOption = (
	option: string | ((args: GoalActionRunArgs) => string) | undefined,
	args: GoalActionRunArgs
): string | undefined =>
	nonEmpty(typeof option === 'function' ? option(args) : (option ?? undefined))

const hostnameFor = (options: TrackGoalActionOptions, args: GoalActionRunArgs): string => {
	const configured = fromOption(options.hostname, args)
	if (configured) {
		return configured
	}
	const host = nonEmpty(args.req?.headers.get('host'))?.replace(/:\d+$/, '')
	if (host) {
		return host
	}
	throw new AnalyticsTrackError(
		'analytics: trackGoalAction needs a hostname; set the `hostname` option or submit through a request carrying a Host header'
	)
}

/** The fixed value wins; otherwise the named answer, and only when it reads as a number. */
const valueFor = (args: GoalActionRunArgs): number | undefined => {
	const fixed = finiteNumber(args.config.value)
	if (fixed !== undefined) {
		return fixed
	}
	const field = nonEmpty(args.config.valueFrom)
	if (!field) {
		return undefined
	}
	return finiteNumber(args.values.find((entry) => entry.field === field)?.value)
}

const propsFor = (args: GoalActionRunArgs): Record<string, unknown> => {
	const props: Record<string, unknown> = {
		formId: String(args.form.id),
		submissionId: String(args.submissionId),
	}
	const title = nonEmpty(args.form.title)
	if (title) {
		props.formTitle = title
	}
	return props
}

/**
 * A form-builder post-submit action that completes an analytics goal, authored per form in
 * the admin: pick the goal, optionally a revenue value (fixed, or read from a submission
 * field) and its currency. Register it through form-builder's `actions` option.
 *
 * Needs the native adapter, since it records through {@link trackServerEvent}. `essential`
 * is deliberately unset: a goal is a measurement, so a failed write is logged and the
 * submission still succeeds.
 */
export const trackGoalAction = (options: TrackGoalActionOptions = {}): GoalActionDefinition => ({
	type: GOAL_ACTION_TYPE,
	label: { en: en[keys.actionGoalLabel], de: de[keys.actionGoalLabel] },
	config: configFields(),
	validateConfig: (config, ctx) =>
		goalSlug(config.goal) ? true : asTranslate(ctx.req.t)(keys.actionGoalErrorGoal),
	run: async (args) => {
		const slug = goalSlug(args.config.goal)
		if (!slug) {
			throw new AnalyticsTrackError('analytics: trackGoalAction has no goal configured')
		}
		await trackServerEvent(
			args.payload,
			{
				type: 'goal',
				name: slug,
				path: fromOption(options.path, args) ?? `/forms/${args.form.id}`,
				hostname: hostnameFor(options, args),
				value: valueFor(args),
				currency: nonEmpty(args.config.currency),
				props: propsFor(args),
			},
			{ req: args.req }
		)
	},
})
