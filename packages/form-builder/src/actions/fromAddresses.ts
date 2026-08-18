import type { PayloadRequest, TextField } from 'payload'
import { keys } from '../translations/keys'
import { asTranslate, labelFor } from '../translations/server'
import { isPlausibleEmail } from './emailRecipients'
import type { RecipientResolveArgs } from './recipientSources'

/** One selectable "from" address for the built-in email actions. */
export type FromAddressOption = { label: string; value: string }

/**
 * A sender the plugin resolves server-side at send time (plugin option `email.fromSources`), the
 * from-side counterpart of a `RecipientSource`. `value` is the namespaced string stored on the
 * action (e.g. `tenant:default`), so it cannot collide with a literal address and stays
 * audit-stable while the address it resolves to follows the host; `label` is what the editor sees
 * in the from select. `resolve` returns the address to send from right now (reduced to a single
 * address), or null/empty to send with the email adapter's default sender. A throw fails the
 * action loudly (and retries on the queued path) rather than sending as the wrong identity.
 */
export type FromAddressSource = {
	value: string
	label: string | Record<string, string>
	resolve: (args: RecipientResolveArgs) => Promise<string | null> | string | null
}

export type FromAddressSourceRegistry = Record<string, FromAddressSource>

/**
 * The `from` handed to `payload.sendEmail`: a stored source value re-resolves through its source
 * with the run-time args; anything else (a literal picked from `fromAddresses`, which never
 * touches a source at send) is forwarded verbatim, and no configured value means no `from` at
 * all. Mirrors `resolveRecipientEntries`: a throwing source propagates.
 */
export const resolveSendFrom = async (opts: {
	configured: string | undefined
	sources?: Map<string, FromAddressSource>
	sourceArgs?: RecipientResolveArgs
}): Promise<string | undefined> => {
	const { configured, sources, sourceArgs } = opts
	if (!configured) {
		return undefined
	}
	const source = sources?.get(configured)
	if (!source) {
		return configured
	}
	// A source only resolves with the run-time args; there are none at authoring/validation time.
	const resolved = sourceArgs ? await source.resolve(sourceArgs) : null
	if (!resolved) {
		return undefined
	}
	return firstSender(resolved) || undefined
}

/** A bare plausible address, or a `Name <addr>` display form wrapping one (quotes and commas in the name included). */
const isPlausibleSender = (value: string): boolean => {
	if (isPlausibleEmail(value)) {
		return true
	}
	const bracketed = /^[^<>]*<([^<>\s]+)>$/.exec(value)
	return Boolean(bracketed?.[1] && isPlausibleEmail(bracketed[1]))
}

/**
 * The sender-side counterpart of `firstAddress`: one sender only, but `Name <addr>` display form
 * survives because that is the documented shape of a `from`. Order matters: cut at line breaks
 * first (the header-injection vector), accept the whole remaining line so a quoted display name
 * may contain commas, and only then comma-split to clamp a multi-address result to its first
 * entry. An implausible result becomes empty (send with the adapter default) rather than a
 * broken header.
 */
const firstSender = (value: string): string => {
	const line = (value.split(/[\n\r]+/)[0] ?? '').trim()
	if (isPlausibleSender(line)) {
		return line
	}
	const [first] = line.split(/[,;]+/)
	const cleaned = (first ?? '').trim()
	return isPlausibleSender(cleaned) ? cleaned : ''
}

/**
 * Host seam resolving the selectable `from` addresses for `emailTeam`/`confirmation`
 * (plugin option `email.fromAddresses`). Multi-tenant hosts derive tenant scoping from `req`
 * (host header, cookie, or auth context) and return only that tenant's allowed senders. `value`
 * is the literal string handed to `payload.sendEmail`'s `from` (e.g. `'Name <addr@x.com>'` or a
 * plain address). Absent keeps the email adapter's default sender and adds no `from` field at all.
 */
export type FromAddressesResolver = (args: {
	req: PayloadRequest
}) => Promise<FromAddressOption[]> | FromAddressOption[]

const FROM_FIELD_REF = '@10x-media/form-builder/client#EndpointOptionsSelect'

/**
 * Validate for the `from` field, closed over the host resolver (mirrors the confirmation action's
 * `toField` and poll's `resultsField`): unset is fine, otherwise the value must be one of the
 * resolver's options for this request. A throwing resolver fails closed with a translated message
 * rather than surfacing a raw error on save.
 *
 * Failing closed has an operational cost worth knowing: Payload runs this on every save, not only
 * when `from` changed, so for as long as the resolver is down no form carrying an email action with
 * a `from` set can be saved at all, including edits that never touch the address. That is the
 * deliberate trade: failing open would persist a sender the host can no longer vouch for, and
 * unlike `toField` and `resultsField` this seam depends on host infrastructure that can be down.
 * A resolver reaching a flaky upstream should cache or fall back internally rather than throw.
 */
export const validateFromField =
	(resolver: FromAddressesResolver | undefined, sourceValues?: Set<string>) =>
	async (value: unknown, { req }: { req: PayloadRequest }): Promise<string | true> => {
		if (typeof value !== 'string' || value.length === 0) {
			return true
		}
		// A registered source value validates by membership alone, no resolver round trip.
		if (sourceValues?.has(value)) {
			return true
		}
		if (!resolver) {
			return asTranslate(req.t)(keys.validationFromUnknown)
		}
		let options: FromAddressOption[]
		try {
			options = await resolver({ req })
		} catch {
			return asTranslate(req.t)(keys.validationFromUnavailable)
		}
		return options.some((option) => option.value === value)
			? true
			: asTranslate(req.t)(keys.validationFromUnknown)
	}

/**
 * The `from` select shared by `emailTeam` and `confirmation`: an `EndpointOptionsSelect` backed by
 * the forms collection's `/:id/from-addresses` endpoint (registered only when `email.fromAddresses`
 * is set). That route's document id goes unused server-side: the option set is request-scoped, not
 * per-form, so this reuses the existing doc-scoped component as-is instead of adding an id-less mode.
 */
export const buildFromField = (
	resolver: FromAddressesResolver | undefined,
	sources?: FromAddressSourceRegistry
): TextField => ({
	name: 'from',
	type: 'text',
	label: labelFor(keys.actionConfigFrom),
	validate: validateFromField(
		resolver,
		sources ? new Set(Object.values(sources).map((source) => source.value)) : undefined
	),
	admin: {
		components: {
			Field: {
				path: FROM_FIELD_REF,
				clientProps: {
					endpoint: 'from-addresses',
					descriptionKey: keys.actionConfigFromDescription,
				},
			},
		},
	},
})

export type ResolveFromAddressesRequestArgs = {
	/** Whether the caller is authenticated (an admin/user). */
	isAuthed: boolean
	req: PayloadRequest
	resolver?: FromAddressesResolver
	sources?: FromAddressSourceRegistry
}

/**
 * A source entry as the from select shows it. A string label is display text served raw (matching
 * how `RecipientsSelect` receives source labels); a per-locale record picks the request's admin
 * language, then English, then any value.
 */
const sourceOption = (source: FromAddressSource, req: PayloadRequest): FromAddressOption => {
	if (typeof source.label === 'string') {
		return { label: source.label, value: source.value }
	}
	const label =
		source.label[req.i18n.language] ??
		source.label.en ??
		Object.values(source.label)[0] ??
		source.value
	return { label, value: source.value }
}

export type ResolveFromAddressesRequestResult = {
	status: number
	body: { options: FromAddressOption[] } | { errors: { message: string }[] }
}

/**
 * Authorize and resolve the `GET /:id/from-addresses` request backing the `from` selects:
 * authenticated callers get the host resolver's current options for this request; anonymous
 * callers are always refused. The route id is unused (see `buildFromField`). Statuses mirror
 * the poll-options endpoint: 403 unauthenticated, 503 when the resolver throws (fail closed).
 */
export const resolveFromAddressesRequest = async (
	args: ResolveFromAddressesRequestArgs
): Promise<ResolveFromAddressesRequestResult> => {
	const { isAuthed, req, resolver, sources } = args
	if (!isAuthed) {
		return { status: 403, body: { errors: [{ message: 'Forbidden' }] } }
	}
	try {
		// Sources lead: the send-time-resolved sender is the tenant identity, static literals are
		// the exceptions an editor picks deliberately.
		const sourceOptions = Object.values(sources ?? {}).map((source) => sourceOption(source, req))
		const resolved = resolver ? await resolver({ req }) : []
		return { status: 200, body: { options: [...sourceOptions, ...resolved] } }
	} catch {
		return { status: 503, body: { errors: [{ message: 'From addresses unavailable' }] } }
	}
}
