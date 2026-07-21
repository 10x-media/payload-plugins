import { CallControlMakeCallCommand, OriginateCommand } from '@wildix/wms-api-client'
import type { PayloadHandler } from 'payload'
import type { WildixCredentials } from '../types'
import type { WildixAccess } from './access'
import { checkAccess } from './access'
import { resolveWildixClient } from './resolveWildixClient'
import { isRouteMissingError } from './wildixErrors'

type CreateWildixDialHandlerOptions = {
	credentials: WildixCredentials
	access?: WildixAccess
	singleUserEmail?: string
	wildixUsersSlug?: string
}

/**
 * Initiates an outbound call. Primary path is the WMS Call Control `make-call`
 * action (rings the user's device first, then bridges to the callee). Tenants
 * without Call Control v2 (the `/api/v2/call-control/*` routes 404) fall back to
 * the AMI `Originate` action, which dials a `Local/<ext>` channel into the user's
 * dialplan context toward the callee.
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
			return Response.json({ success: true, via: 'make-call' }, { status: 200 })
		} catch (err) {
			if (!isRouteMissingError(err) || !resolved.userExtension) {
				const detail = err instanceof Error ? err.message : String(err)
				req.payload.logger.error({ detail, callee }, '[wildix:dial] makecall failed')
				return Response.json({ error: 'Failed to dial', detail }, { status: 502 })
			}
		}

		const context = resolved.dialplan ?? 'users'
		try {
			await resolved.client.send(
				new OriginateCommand({
					channel: `Local/${resolved.userExtension}@${context}`,
					context,
					exten: callee,
					priority: '1',
					async: 'true',
				})
			)
			return Response.json({ success: true, via: 'originate' }, { status: 200 })
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err)
			req.payload.logger.error({ detail, callee }, '[wildix:dial] originate fallback failed')
			return Response.json({ error: 'Failed to dial', detail }, { status: 502 })
		}
	}
