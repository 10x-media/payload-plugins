import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { umami } from '../../src/adapters/umami/umami'

const KNOWN_WEBSITE = 'd2ff4b28-1a41-4a87-abd4-b4897d7234c0'

/** Self-hosted Umami 3 on loopback: an unknown website id is answered 200 with a `null` body. */
const startUmami = async () => {
	const server = createServer((req, res) => {
		res.writeHead(200, { 'content-type': 'application/json' })
		res.end(
			req.url === `/api/websites/${KNOWN_WEBSITE}`
				? JSON.stringify({ id: KNOWN_WEBSITE, name: 'Site', domain: 'site.example' })
				: 'null'
		)
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const { port } = server.address() as AddressInfo
	return {
		origin: `http://127.0.0.1:${port}`,
		stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
	}
}

let vendor: Awaited<ReturnType<typeof startUmami>>

beforeAll(async () => {
	vendor = await startUmami()
})

afterAll(async () => {
	await vendor?.stop()
})

const check = (websiteId: string) =>
	umami({ websiteId, token: 't', host: vendor.origin }).checkConnection?.({
		signal: AbortSignal.timeout(5_000),
		timeoutMs: 5_000,
	})

it('passes the check for a website Umami knows', async () => {
	await expect(check(KNOWN_WEBSITE)).resolves.toBeUndefined()
})

it('fails the check for a website id Umami does not know', async () => {
	await expect(check('00000000-0000-4000-8000-000000000000')).rejects.toThrow()
})
