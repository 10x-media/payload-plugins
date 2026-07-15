import { CallControlMakeCallCommand } from '@wildix/wms-api-client'
import type { PayloadHandler } from 'payload'
import type { WildixCredentials } from '../types'
import type { WildixAccess } from './access'
import { checkAccess } from './access'
import { resolveWildixClient } from './resolveWildixClient'

type CreateWildixDialHandlerOptions = {
	credentials: WildixCredentials
	access?: WildixAccess
	singleUserEmail?: string
	wildixUsersSlug?: string
}

/**
 * Initiates an outbound call via the WMS Call Control `makecall` action. The call
 * rings the resolved user's device first, then bridges to the callee. `device` is
 * an optional SIP contact; when omitted the user's default device is used.
 */
export const createWildixDialHandler =
	({
		credentials,
		access,
		singleUserEmail,
		wildixUsersSlug,
	}: CreateWildixDialHandlerOptions): PayloadHandler =>
	async (req) => {
		const denied = await checkAccess(req, access, 'dial')
		if (denied) return denied

		if (!req.json) {
			return Response.json({ error: 'No body' }, { status: 400 })
		}
		const { callee, deviceId } = await req.json()
		if (!callee) {
			return Response.json({ error: 'callee is required' }, { status: 400 })
		}

		const resolved = await resolveWildixClient({
			req,
			credentials,
			wildixUsersSlug,
			singleUserEmail,
		})
		if ('error' in resolved) return resolved.error

		try {
			await resolved.client.send(
				new CallControlMakeCallCommand({
					user: resolved.userExtension,
					destination: callee,
					device: deviceId,
				})
			)
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err)
			req.payload.logger.error({ detail, callee }, '[wildix:dial] makecall failed')
			return Response.json({ error: 'Failed to dial', detail }, { status: 502 })
		}

		return Response.json({ success: true }, { status: 200 })
	}
