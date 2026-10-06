import type { I18nClient } from '@payloadcms/translations'
import { headers as nextHeaders } from 'next/headers'
import type { Payload, PayloadRequest } from 'payload'
import { createLocalReq } from 'payload'

/**
 * A request object for the plugin's server provider, which Payload does not hand one.
 *
 * `admin.components.providers` are rendered by `RootLayout` through `NestProviders`, and the
 * server props it passes are only `i18n`, `payload`, `permissions` and `user`. Access
 * functions in this plugin take `{ req }` so one predicate can gate both this plugin and the
 * sidebar, so the provider builds a request instead of narrowing the contract.
 *
 * The headers are the real ones, which is what `resolveDocID` needs to read a tenant cookie.
 * Everything else is local: `req.payloadAPI` is `'local'`, and there is no response to write
 * to. The lazy tier goes through `render-widget` and gets Payload's own request, not this one.
 */
export const buildProviderReq = async (args: {
	i18n: I18nClient
	payload: Payload
	/**
	 * Typed as the request's own user rather than `ClientUser`: in a project with generated types
	 * those two disagree on nullability, and this one comes straight from the server props.
	 */
	user: PayloadRequest['user']
}): Promise<PayloadRequest> => {
	const headers = await nextHeaders()

	return createLocalReq(
		{
			req: {
				headers,
				i18n: args.i18n,
			} as unknown as PayloadRequest,
			user: args.user ?? undefined,
		},
		args.payload
	)
}
