import type { Payload, PayloadRequest } from 'payload'
import { instanceOptionsOf } from '../fields/instanceOptions'
import { type FieldTypeRegistry, fieldTypesOf } from '../fields/registry'
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
	/**
	 * Field-type registry override; defaults to the one stashed on the config. Lets the results
	 * field's definition source its own options via {@link FormFieldDefinition.resolveOptions}.
	 */
	fieldTypes?: FieldTypeRegistry
}

const CACHE_KEY = 'formBuilderFieldOptionsCache'

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

/**
 * The poll's currently valid choice set, resolved in a fixed precedence: source-resolved options
 * when the poll has an `optionSource`, else the results field type's own {@link
 * FormFieldDefinition.resolveOptions} when it declares one (given the live field instance so a
 * custom type can enumerate the values it holds), else the authored options of the field instance.
 * Empty when the poll is disabled, no results field is set, or none of the branches yields options.
 * This single set backs both the admin winner select (the `/:id/poll-options` endpoint) and outcome
 * membership validation, so what the admin offers and what the server accepts cannot drift. Source
 * and resolver failures propagate so callers fail closed; the resolver branch is cached per request
 * (keyed by form id) when a `req` is provided, matching the source path.
 */
export const resolveEffectivePollOptions = async (
	args: ResolveEffectivePollOptionsArgs
): Promise<PollOption[]> => {
	const { payload, req, form, sources, fieldTypes } = args
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
	if (!instance) {
		return []
	}
	const definition = (fieldTypes ?? fieldTypesOf(payload)).get(instance.blockType)
	if (definition?.resolveOptions) {
		const cache = cacheOf(req)
		const cacheKey = String(form.id)
		const cached = cache?.get(cacheKey)
		if (cached) {
			return cached
		}
		const options = await definition.resolveOptions({
			instance,
			form: { id: form.id, title: typeof form.title === 'string' ? form.title : undefined },
			payload,
			req,
		})
		cache?.set(cacheKey, options)
		return options
	}
	return instanceOptionsOf(instance) ?? []
}
