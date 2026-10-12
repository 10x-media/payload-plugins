import type { Field, Payload, PayloadRequest } from 'payload'
import { AnalyticsTrackError, type ServerTrackIdentity } from '../core/serverEvent'
import { valueAt } from '../core/values'
import { normalizeHostname, requestHostname } from '../native/ingest/requestHost'
import { ingestAdapter, trackServerEvent } from '../native/ingest/serverTrack'
import { getRuntime } from '../plugin/runtime'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import { amountField } from './amountField'
import { GOAL_ACTION_TYPE } from './constants'
import { type AmountOf, amountCurrencyField, CURRENCY_PATTERN } from './currency'
import { goalField, goalSlug } from './goalField'
import { finiteNumber } from './match'
import { applyRevenueVisibility, moneyField } from './moneyFields'

export { GOAL_ACTION_TYPE }

/**
 * Form-builder's post-submit run context as goal tracking reads it, structural so analytics never
 * depends on form-builder at runtime.
 */
export interface GoalActionRunArgs {
	form: { id: number | string; title?: string }
	submissionId: number | string
	/** One entry per answered field, keyed by the field's machine name. */
	values: Array<{ field: string; value: unknown }>
	config: Record<string, unknown>
	payload: Payload
	/**
	 * The request the action runs under. On a queued dispatch this is the job runner's own
	 * request, not the visitor's, so it carries neither the submitting host nor the tenant.
	 */
	req?: PayloadRequest
}

/**
 * Structural counterpart of form-builder's `ActionDefinition<Record<string, unknown>>`; a
 * value of this type is assignable to it, which `trackGoalAction.test.ts` pins.
 */
export interface GoalActionDefinition {
	type: typeof GOAL_ACTION_TYPE
	label: string | Record<string, string>
	config: Field[]
	run: (args: GoalActionRunArgs) => Promise<void>
}

export interface TrackGoalActionOptions {
	/**
	 * Site the completion belongs to; falls back to the submitting host (per the hostname policy), then
	 * `serverURL`, else nothing is recorded. Set it whenever a jobs runner queues actions.
	 */
	hostname?: string | ((args: GoalActionRunArgs) => string)
	/** Page the completion is attributed to. Defaults to `/forms/<form id>`. */
	path?: string | ((args: GoalActionRunArgs) => string)
	/**
	 * Analytics boundary to stamp, `null` install-wide. Unset, it resolves from the action's request, so
	 * set it on any scoped install whose actions are queued.
	 */
	scope?: string | null | ((args: GoalActionRunArgs) => string | null | Promise<string | null>)
	/**
	 * `'none'` records no visitor id, location, device or language; a function decides per submission
	 * from the host's consent. Defaults as `trackServerEvent`'s `identity`.
	 */
	identity?:
		| ServerTrackIdentity
		| ((args: GoalActionRunArgs) => ServerTrackIdentity | Promise<ServerTrackIdentity>)
	/**
	 * Whether the action offers amount inputs. Set it to match your `revenue` option: form-builder often
	 * registers its blocks too late for the plugin to hide them.
	 */
	revenue?: boolean
	/**
	 * Currency the Amount control fills in for an amount set without one, normally your
	 * `revenue.currency`. Unset, the editor picks.
	 */
	defaultCurrency?: string
}

/** The amount the action's currency belongs to: its fixed amount. */
const fixedAmount: AmountOf = ({ siblingData }) => valueAt(siblingData, 'value')

const configFields = (defaultCurrency: string | undefined): Field[] => [
	goalField({ name: 'goal', required: true }),
	moneyField(
		amountField(
			{ name: 'value', type: 'number', min: 0, label: labelForKey(keys.goalFieldAmount) },
			{ currencyPath: 'currency', defaultCurrency }
		)
	),
	moneyField({
		name: 'valueFrom',
		type: 'text',
		label: labelForKey(keys.actionGoalFieldValueFrom),
		admin: { description: labelForKey(keys.actionGoalFieldValueFromHelp) },
	}),
	moneyField(amountCurrencyField(fixedAmount)),
]

const checkedCurrency = (code: string | undefined): string | undefined => {
	if (code !== undefined && !CURRENCY_PATTERN.test(code)) {
		throw new Error(
			`analytics: trackGoalAction's defaultCurrency must be a three-letter ISO 4217 code, got "${code}"`
		)
	}
	return code
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
): string | undefined => nonEmpty(typeof option === 'function' ? option(args) : option)

const serverUrlHost = (payload: Payload): string | null => {
	const serverURL = nonEmpty(payload.config?.serverURL)
	if (!serverURL) {
		return null
	}
	try {
		return normalizeHostname(new URL(serverURL).hostname)
	} catch {
		return null
	}
}

/**
 * The submitting host as the writing adapter's hostname policy judges it: a `Host` header is
 * forgeable, and a conversion must not mint a hostname ingest would refuse.
 */
const policyHostname = async (
	args: GoalActionRunArgs,
	scope: string | null
): Promise<string | null> => {
	if (!args.req) {
		return null
	}
	const policy = ingestAdapter(args.payload)?.ingest?.hostname
	if (policy) {
		return policy({ req: args.req, scope })
	}
	return requestHostname(args.req.headers, {
		trustedProxyHops: getRuntime(args.payload)?.trustedProxyHops,
	})
}

/**
 * The option, then the submitting request under the hostname policy, then `serverURL`; null means no
 * site can be credited.
 */
const hostnameFor = async (
	options: TrackGoalActionOptions,
	args: GoalActionRunArgs,
	scope: string | null
): Promise<string | null> => {
	const configured = normalizeHostname(fromOption(options.hostname, args))
	if (configured) {
		return configured
	}
	return (await policyHostname(args, scope)) ?? serverUrlHost(args.payload)
}

let warnedNoHostname = false

/** Once per process, so repeated public submissions cannot choose how much the log grows. */
const warnNoHostname = (payload: Payload): void => {
	if (warnedNoHostname) {
		return
	}
	warnedNoHostname = true
	payload.logger?.warn(
		"analytics: a form goal could not be recorded because no hostname resolved: set serverURL or check the adapter's hostname policy"
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

const scopeFor = async (
	options: TrackGoalActionOptions,
	args: GoalActionRunArgs
): Promise<{ scope?: string | null }> => {
	if (options.scope === undefined) {
		return {}
	}
	return { scope: typeof options.scope === 'function' ? await options.scope(args) : options.scope }
}

/**
 * A form-builder post-submit action completing an analytics goal, configured per form; needs the
 * native adapter. Not essential: a failed write is logged and the submission still succeeds.
 */
export const trackGoalAction = (options: TrackGoalActionOptions = {}): GoalActionDefinition => ({
	type: GOAL_ACTION_TYPE,
	label: keys.actionGoalLabel,
	config: applyRevenueVisibility(
		configFields(checkedCurrency(options.defaultCurrency)),
		options.revenue ?? true
	),
	run: async (args) => {
		const slug = goalSlug(args.config.goal)
		if (!slug) {
			throw new AnalyticsTrackError('analytics: trackGoalAction has no goal configured')
		}
		const scope = await scopeFor(options, args)
		const hostname = await hostnameFor(options, args, scope.scope ?? null)
		if (!hostname) {
			warnNoHostname(args.payload)
			return
		}
		const identity =
			typeof options.identity === 'function' ? await options.identity(args) : options.identity
		await trackServerEvent(
			args.payload,
			{
				type: 'goal',
				name: slug,
				path: fromOption(options.path, args) ?? `/forms/${args.form.id}`,
				hostname,
				value: valueFor(args),
				currency: nonEmpty(args.config.currency),
				props: propsFor(args),
				...scope,
			},
			{ req: args.req, ...(identity === undefined ? {} : { identity }) }
		)
	},
})
