import type { Payload, PayloadRequest } from 'payload'
import { instanceOptionsOf } from '../fields/instanceOptions'
import { pollConfigOf } from '../form/pollState'
import type { FormFieldInstance } from '../submissions/types'
import type { PollOption } from './definePollOptionSource'
import type { PollOptionSourceRegistry } from './registry'
import { resolvePollOptions } from './resolvePollOptions'

export type ResolveEffectivePollOptionsArgs = {
	payload: Payload
	req?: PayloadRequest
	/** A forms document (or an equivalent merged view of one during a save). */
	form: { id: number | string; title?: string | null; poll?: unknown; fields?: unknown }
	/** Registry override for plugin-internal callers; defaults to the registry stashed on the config. */
	sources?: PollOptionSourceRegistry
}

/**
 * The poll's currently valid choice set: source-resolved options when the poll has an
 * `optionSource`, otherwise the authored options of the field instance named `poll.resultsField`.
 * Empty when the poll is disabled, no results field is set, or the instance declares no options.
 * This single set backs both the admin winner select (the `/:id/poll-options` endpoint) and
 * outcome membership validation, so what the admin offers and what the server accepts cannot
 * drift. Source resolution failures propagate so callers fail closed.
 */
export const resolveEffectivePollOptions = async (
	args: ResolveEffectivePollOptionsArgs
): Promise<PollOption[]> => {
	const { payload, req, form, sources } = args
	const poll = pollConfigOf(form.poll)
	if (poll?.enabled !== true) {
		return []
	}
	const sourced = await resolvePollOptions({ payload, req, form, sources })
	if (sourced) {
		return sourced
	}
	const resultsField =
		typeof poll.resultsField === 'string' && poll.resultsField.length > 0
			? poll.resultsField
			: undefined
	if (!resultsField) {
		return []
	}
	const instances = Array.isArray(form.fields) ? (form.fields as FormFieldInstance[]) : []
	const instance = instances.find((entry) => entry.name === resultsField)
	return instance ? (instanceOptionsOf(instance) ?? []) : []
}
