import type { Field, Payload, PayloadRequest } from 'payload'
import { AnalyticsTrackError } from '../core/serverEvent'
import { normalizeHostname, requestHostname } from '../native/ingest/requestHost'
import { ingestAdapter, trackServerEvent } from '../native/ingest/serverTrack'
import { getRuntime } from '../plugin/runtime'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import { validateCurrency } from './currency'
import { goalField, goalSlug } from './goalField'

/** The action type form-builder stores as the block slug on a form's `actions` array. */
export const GOAL_ACTION_TYPE = 'analyticsGoal'

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
	 * Site the completion belongs to. Falls back to the submitting request's host as the
	 * native adapter's `hostname` policy judges it, then to the host of `serverURL`. With none
	 * of the three the completion is not recorded at all, and one warning names the install.
	 * Set it whenever a jobs runner queues actions: the runner's request carries the CMS host
	 * at best, and often no host at all.
	 */
	hostname?: string | ((args: GoalActionRunArgs) => string)
	/** Page the completion is attributed to. Defaults to `/forms/<form id>`. */
	path?: string | ((args: GoalActionRunArgs) => string)
	/**
	 * Analytics boundary to stamp; `null` is install-wide. Leave unset and the scope resolves
	 * from the action's request, which on a queued dispatch is the runner's rather than the
	 * submitter's and so usually lands install-wide. Set it on any scoped install whose
	 * actions are queued, since the submitter's tenant cannot be recovered there.
	 */
	scope?: string | null | ((args: GoalActionRunArgs) => string | null | Promise<string | null>)
}

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
 * The submitting request's host as the hostname policy of the very adapter the event is written
 * through judges it: a `Host` header is forgeable, and a conversion must not be able to mint a
 * hostname the ingest endpoint would have refused. Without that adapter exposing the seam the
 * request's own host stands in, which is the policy's default anyway.
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
 * The option, then the submitting request under the ingest hostname policy, then the install's
 * own `serverURL`. Every rung is normalized to the one hostname shape, and null means the
 * conversion cannot be attributed to any site at all. The queued dispatch path reaches the last
 * two with the runner's request, so an install that queues actions and serves more than one
 * site has to say which site in the option.
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

/**
 * Once per process: a public form would otherwise let a repeated submission choose how much the
 * log grows, and a whole install misconfigured this way is one line's worth of news.
 */
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
 * A form-builder post-submit action that completes an analytics goal, authored per form in
 * the admin: pick the goal, optionally a revenue value (fixed, or read from a submission
 * field) and its currency. Register it through form-builder's `actions` option under
 * {@link GOAL_ACTION_TYPE}.
 *
 * Needs the native adapter, since it records through {@link trackServerEvent}. `essential`
 * is deliberately unset: a goal is a measurement, so a failed write is logged and the
 * submission still succeeds.
 *
 * On any install with a jobs runner, form-builder queues non-essential actions, and the
 * queued run carries the runner's request rather than the visitor's. Set `hostname` (and
 * `scope`, on a scoped install) there, since neither can be recovered from that request.
 */
export const trackGoalAction = (options: TrackGoalActionOptions = {}): GoalActionDefinition => ({
	type: GOAL_ACTION_TYPE,
	label: keys.actionGoalLabel,
	config: configFields(),
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
			{ req: args.req }
		)
	},
})
