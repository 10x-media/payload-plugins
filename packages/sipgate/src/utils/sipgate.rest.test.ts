import { describe, expect, it, test } from 'vitest'
import { buildSipgateRest, hangupCall, transferCall } from './sipgate.rest'

// biome-ignore lint/plugin/noProcessEnv: test env boundary
const HAS_LIVE_CREDS = Boolean(process.env.SIPGATE_TOKEN && process.env.SIPGATE_TOKEN_ID)

describe('hangupCall / transferCall — error propagation', () => {
	it('hangupCall throws when the response is not ok (mock)', async () => {
		const failingRest = async () => new Response('Not Found', { status: 404 })
		await expect(hangupCall(failingRest, 'nonexistent')).rejects.toThrow()
	})

	it('transferCall throws when the response is not ok (mock)', async () => {
		const failingRest = async () => new Response('Bad Request', { status: 400 })
		await expect(
			transferCall(failingRest, 'nonexistent', {
				attended: false,
				callerId: '+49000',
				phoneNumber: '+49000',
			})
		).rejects.toThrow()
	})

	test.skipIf(!HAS_LIVE_CREDS)(
		'hangupCall throws on a real sipgate 4xx for a nonexistent call',
		async () => {
			const rest = buildSipgateRest({
				authType: 'pat',
				// biome-ignore lint/plugin/noProcessEnv: test env boundary
				tokenId: process.env.SIPGATE_TOKEN_ID,
				// biome-ignore lint/plugin/noProcessEnv: test env boundary
				token: process.env.SIPGATE_TOKEN,
			})
			await expect(hangupCall(rest, 'this-call-id-does-not-exist')).rejects.toThrow()
		}
	)
})
