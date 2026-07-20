import type { PayloadRequest, TextField } from 'payload'
import { keys } from '../translations/keys'
import { asTranslate, labelFor } from '../translations/server'

/** One selectable "from" address for the built-in email actions. */
export type FromAddressOption = { label: string; value: string }

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
	(resolver: FromAddressesResolver) =>
	async (value: unknown, { req }: { req: PayloadRequest }): Promise<string | true> => {
		if (typeof value !== 'string' || value.length === 0) {
			return true
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
export const buildFromField = (resolver: FromAddressesResolver): TextField => ({
	name: 'from',
	type: 'text',
	label: labelFor(keys.actionConfigFrom),
	validate: validateFromField(resolver),
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
	resolver: FromAddressesResolver
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
	const { isAuthed, req, resolver } = args
	if (!isAuthed) {
		return { status: 403, body: { errors: [{ message: 'Forbidden' }] } }
	}
	try {
		const options = await resolver({ req })
		return { status: 200, body: { options } }
	} catch {
		return { status: 503, body: { errors: [{ message: 'From addresses unavailable' }] } }
	}
}
