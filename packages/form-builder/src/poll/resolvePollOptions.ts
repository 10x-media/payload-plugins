import type { Payload, PayloadRequest } from 'payload'
import { pollConfigOf } from '../form/pollState'
import { customStateOf, stashCustomState } from '../plugin/customState'
import type { PollOption } from './definePollOptionSource'
import type { PollOptionSourceRegistry } from './registry'

type PollCustomState = { pollOptionSources: PollOptionSourceRegistry }

/** Store the resolved registry on the config so `resolvePollOptions` can find it via `payload.config`. */
export const stashPollOptionSources = (
	custom: Record<string, unknown> | undefined,
	registry: PollOptionSourceRegistry
): Record<string, unknown> =>
	stashCustomState<PollCustomState>(custom, { pollOptionSources: registry })

export const pollOptionSourcesOf = (payload: Payload): PollOptionSourceRegistry =>
	customStateOf<PollCustomState>(payload).pollOptionSources ?? new Map()

const CACHE_KEY = 'formBuilderPollOptionsCache'

type OptionsCache = Map<string, PollOption[]>

const cacheOf = (req: PayloadRequest | undefined): OptionsCache | undefined => {
	if (!req?.context) {
		return undefined
	}
	const existing = req.context[CACHE_KEY]
	if (existing instanceof Map) {
		return existing as OptionsCache
	}
	const created: OptionsCache = new Map()
	req.context[CACHE_KEY] = created
	return created
}

export type ResolvePollOptionsArgs = {
	payload: Payload
	req?: PayloadRequest
	/** A loaded forms document; its top-level `pollEnabled` flag and `poll` config drive resolution. */
	form: { id: number | string; title?: string | null; pollEnabled?: boolean | null; poll?: unknown }
	/** Registry override for plugin-internal callers; defaults to the registry the plugin stashed on the config. */
	sources?: PollOptionSourceRegistry
}

/**
 * Resolve a poll-enabled form's choice options from its configured option source (plugin option
 * `poll.sources`). Returns `undefined` when the form is not poll-enabled or has no `optionSource`
 * set, so hand-authored options render unchanged. Hosts call this server-side and hand the result
 * to `toFormDocument(doc, { pollOptions })`; submission validation calls it too, making the
 * resolved values the only accepted answers. Throws when the configured source type is not
 * registered or its `resolve` fails; results are cached per request (keyed by form id) when a
 * `req` is provided.
 */
export const resolvePollOptions = async (
	args: ResolvePollOptionsArgs
): Promise<PollOption[] | undefined> => {
	const { payload, req, form, sources } = args
	const poll = pollConfigOf(form.poll)
	const optionSource = typeof poll?.optionSource === 'string' ? poll.optionSource : undefined
	if (form.pollEnabled !== true || !poll || !optionSource) {
		return undefined
	}
	const source = (sources ?? pollOptionSourcesOf(payload)).get(optionSource)
	if (!source) {
		throw new Error(
			`Poll option source "${optionSource}" is not registered. Register it via the plugin's poll.sources option.`
		)
	}
	const cache = cacheOf(req)
	const cacheKey = String(form.id)
	const cached = cache?.get(cacheKey)
	if (cached) {
		return cached
	}
	const config =
		poll.sourceConfig != null && typeof poll.sourceConfig === 'object'
			? (poll.sourceConfig as Record<string, unknown>)
			: {}
	const options = await source.resolve({
		config,
		form: { id: form.id, title: typeof form.title === 'string' ? form.title : undefined },
		payload,
		req,
	})
	cache?.set(cacheKey, options)
	return options
}
