import type { Payload } from 'payload'
import { customStateOf, stashCustomState } from '../plugin/customState'
import { keys } from '../translations/keys'
import { definePollType, type PollOutcomeStrategy } from './definePollType'
import { mostVotedStrategy } from './mostVoted'
import { pollOptionSourcesOf } from './resolvePollOptions'

export type PollTypeRegistry = Map<string, PollOutcomeStrategy>

/**
 * Host-supplied outcome strategies: a keyed record (the key forces `type`, like the field-type
 * registry) or a plain array. There are no boolean toggles because the three built-ins are always
 * registered; a host entry with a built-in's `type` replaces it.
 */
export type PollTypesConfig = Record<string, PollOutcomeStrategy> | PollOutcomeStrategy[]

/** The default: an admin records `winningValues` by hand, so there is nothing to auto-resolve. */
export const manualStrategy: PollOutcomeStrategy = definePollType({
	type: 'manual',
	label: keys.pollTypeManual,
	resolveOutcome: () => undefined,
})

/** One winner set as a deduped array of non-empty strings, or `undefined` when the source yields none. */
const normalizeSourceOutcome = (value: string | string[] | undefined): string[] | undefined => {
	if (value === undefined) {
		return undefined
	}
	const cleaned = [
		...new Set(
			(Array.isArray(value) ? value : [value]).filter(
				(entry): entry is string => typeof entry === 'string' && entry.length > 0
			)
		),
	]
	return cleaned.length > 0 ? cleaned : undefined
}

/**
 * Delegate to the poll's configured option source `resolveOutcome` (the same domain resolver that
 * feeds explicit `resolvePollOutcome` auto mode before this task shipped). Returns `undefined` when
 * the poll has no source, the source is unregistered, or it does not implement `resolveOutcome`, so a
 * misconfigured poll never throws from the close job or the read fallback; a source that resolves to
 * no decision (its `resolveOutcome` returns `undefined`) also yields `undefined`.
 */
export const sourceStrategy: PollOutcomeStrategy = definePollType({
	type: 'source',
	label: keys.pollTypeSource,
	resolveOutcome: async ({ payload, req, form, poll }) => {
		const optionSource =
			typeof poll.optionSource === 'string' && poll.optionSource.length > 0
				? poll.optionSource
				: undefined
		if (!optionSource) {
			return undefined
		}
		const source = pollOptionSourcesOf(payload).get(optionSource)
		if (!source?.resolveOutcome) {
			return undefined
		}
		const config =
			poll.sourceConfig != null && typeof poll.sourceConfig === 'object'
				? (poll.sourceConfig as Record<string, unknown>)
				: {}
		return normalizeSourceOutcome(
			await source.resolveOutcome({
				config,
				form: { id: form.id, title: typeof form.title === 'string' ? form.title : undefined },
				payload,
				req,
			})
		)
	},
})

/**
 * The active poll-type registry: the three always-registered built-ins (`manual`, `mostVoted`,
 * `source`) plus any host strategies from the plugin `poll.types` option. A host entry keyed by (or
 * carrying a `type` of) a built-in slug replaces that built-in. Mirrors the field-type registry: a
 * record key forces the strategy's `type` so a keyed override cannot rename the slot.
 */
export const resolvePollTypes = (config?: PollTypesConfig): PollTypeRegistry => {
	const registry: PollTypeRegistry = new Map([
		[manualStrategy.type, manualStrategy],
		[mostVotedStrategy.type, mostVotedStrategy],
		[sourceStrategy.type, sourceStrategy],
	])
	if (Array.isArray(config)) {
		for (const strategy of config) {
			registry.set(strategy.type, strategy)
		}
	} else if (config) {
		for (const [type, strategy] of Object.entries(config)) {
			registry.set(type, { ...strategy, type })
		}
	}
	return registry
}

type PollTypesCustomState = { pollTypes: PollTypeRegistry }

/** Store the resolved registry on the config so `resolvePollOutcome` can reach it via `payload.config`. */
export const stashPollTypes = (
	custom: Record<string, unknown> | undefined,
	registry: PollTypeRegistry
): Record<string, unknown> =>
	stashCustomState<PollTypesCustomState>(custom, { pollTypes: registry })

export const pollTypesOf = (payload: Payload): PollTypeRegistry =>
	customStateOf<PollTypesCustomState>(payload).pollTypes ?? new Map()
