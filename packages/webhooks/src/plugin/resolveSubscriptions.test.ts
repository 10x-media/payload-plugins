import { describe, expect, it } from 'vitest'
import { SECRET_PREFIX } from '../constants'
import { generateSecret } from '../secrets/format'
import {
	decideDelivery,
	fromCodeSubscription,
	fromCollectionRow,
	matchSubscriptions,
	plaintextSlot,
	resolveSubscriptionById,
	type SecretSlot,
	withReadableHeaders,
} from './resolveSubscriptions'

/** A wire string in `@10x-media/fields` sealed form. */
const SEALED = 'pfe1.k0.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA'

const ABSENT: SecretSlot = { secret: null, state: 'absent' }

describe('plaintextSlot', () => {
	it('normalizes a bare base64 secret onto the whsec_ form', () => {
		const bare = generateSecret().slice(SECRET_PREFIX.length)
		expect(plaintextSlot(bare)).toEqual({ secret: `${SECRET_PREFIX}${bare}`, state: 'ok' })
	})

	it('reads an empty or missing value as absent, not as unusable', () => {
		expect(plaintextSlot('').state).toBe('absent')
		expect(plaintextSlot(undefined).state).toBe('absent')
		expect(plaintextSlot(null).state).toBe('absent')
	})

	it('reports why a malformed secret cannot sign', () => {
		const slot = plaintextSlot('whsec_not base64!')
		expect(slot.state).toBe('unusable')
		expect(slot.state === 'unusable' && slot.reason).toMatch(/base64/)
	})
})

describe('fromCollectionRow', () => {
	const secret = generateSecret()

	it('normalizes ids, headers, and defaults enabled to true', () => {
		const r = fromCollectionRow(
			{
				id: 7,
				url: 'https://x',
				events: ['posts.created'],
				headers: [
					{ key: 'X-A', value: '1' },
					{ key: '', value: 'skip' },
				],
				enabled: null,
			},
			{ active: { secret, state: 'ok' }, retired: ABSENT }
		)
		expect(r).toEqual({
			id: '7',
			source: 'collection',
			url: 'https://x',
			events: ['posts.created'],
			secrets: [secret],
			secretUnusable: false,
			secretUnusableReason: undefined,
			retiredSecretUnusable: false,
			retiredSecretUnusableReason: undefined,
			secretHidden: false,
			headers: { 'X-A': '1' },
			headersUnusable: false,
			enabled: true,
		})
	})

	it('carries the active secret first and the retired one after it', () => {
		const retired = generateSecret()
		const r = fromCollectionRow(
			{ id: 1, url: 'u' },
			{ active: { secret, state: 'ok' }, retired: { secret: retired, state: 'ok' } }
		)
		expect(r.secrets).toEqual([secret, retired])
	})

	it('yields no secrets when neither slot holds one', () => {
		expect(
			fromCollectionRow({ id: 1, url: 'u' }, { active: ABSENT, retired: ABSENT }).secrets
		).toEqual([])
	})
})

describe('decideDelivery', () => {
	const base = fromCollectionRow(
		{ id: 1, url: 'u', events: ['posts.created'] },
		{ active: ABSENT, retired: ABSENT }
	)

	it('delivers a subscription with no secret at all, unsigned', () => {
		expect(decideDelivery(base).deliverable).toBe(true)
	})

	/** A receiver that authenticates on the header would otherwise be sent the request without it. */
	it('refuses a subscription whose encrypted header value could not be recovered', () => {
		const decision = decideDelivery({ ...base, headersUnusable: true })
		expect(decision.deliverable).toBe(false)
		expect(!decision.deliverable && decision.reason).toMatch(/custom header value/)
	})

	it('refuses an unusable active secret, and says which fix it needs', () => {
		const sub = fromCollectionRow(
			{ id: 1, url: 'u' },
			{
				active: { reason: 'the ring is missing its key', secret: null, state: 'unusable' },
				retired: ABSENT,
			}
		)
		const decision = decideDelivery(sub)
		expect(decision.deliverable).toBe(false)
		expect(decision.deliverable === false && decision.reason).toContain(
			'the ring is missing its key'
		)
	})

	it('refuses a secret that was never read for signing rather than sending unsigned', () => {
		const sub = fromCollectionRow(
			{ id: 1, url: 'u' },
			{ active: { secret: null, state: 'hidden' }, retired: ABSENT }
		)
		const decision = decideDelivery(sub)
		expect(decision.deliverable).toBe(false)
		expect(decision.deliverable === false && decision.reason).toMatch(/not read for signing/)
	})

	it('still delivers when only the retired secret is unusable', () => {
		const sub = fromCollectionRow(
			{ id: 1, url: 'u' },
			{
				active: { secret: generateSecret(), state: 'ok' },
				retired: { reason: 'corrupt', secret: null, state: 'unusable' },
			}
		)
		expect(decideDelivery(sub).deliverable).toBe(true)
		expect(sub.retiredSecretUnusable).toBe(true)
	})
})

describe('withReadableHeaders', () => {
	/** A payload whose ordinary read returns `docs`, recording that it was asked. */
	const reader = (docs: unknown[]) => {
		const calls: unknown[] = []
		const payload = {
			find: (args: unknown) => {
				calls.push(args)
				return Promise.resolve({ docs })
			},
		}
		return { calls, payload: payload as never }
	}
	const args = { req: {} as never, subscriptionsSlug: 'webhook-subscriptions' }

	it('reads nothing again when no header value is sealed', async () => {
		const { calls, payload } = reader([])
		const rows = [{ id: 1, url: 'u', headers: [{ id: 'a', key: 'X-A', value: 'plain' }] }]
		expect(await withReadableHeaders({ ...args, payload, rows })).toBe(rows)
		expect(calls).toHaveLength(0)
	})

	it('swaps in the decrypted values for a row that carried sealed ones', async () => {
		const { payload } = reader([
			{ id: 1, headers: [{ id: 'a', key: 'Authorization', value: 'Bearer t0ken' }] },
		])
		const [row] = await withReadableHeaders({
			...args,
			payload,
			rows: [{ id: 1, url: 'u', headers: [{ id: 'a', key: 'Authorization', value: SEALED }] }],
		})
		expect(row?.headers).toEqual([{ id: 'a', key: 'Authorization', value: 'Bearer t0ken' }])
		expect(row?.headersUnreadable).toBe(false)
	})

	/** Ciphertext must never be left in place to go out as the header's value. */
	it('marks the row unreadable when a sealed value does not come back as text', async () => {
		const sealedRow = {
			id: 1,
			url: 'u',
			headers: [{ id: 'a', key: 'Authorization', value: SEALED }],
		}
		const undecryptable = reader([
			{ id: 1, headers: [{ id: 'a', key: 'Authorization', value: null }] },
		])
		const [nulled] = await withReadableHeaders({
			...args,
			payload: undecryptable.payload,
			rows: [sealedRow],
		})
		expect(nulled?.headersUnreadable).toBe(true)

		const gone = reader([])
		const [missing] = await withReadableHeaders({
			...args,
			payload: gone.payload,
			rows: [sealedRow],
		})
		expect(missing?.headersUnreadable).toBe(true)
		expect(missing?.headers).toEqual([])
	})
})

describe('resolveSubscriptionById', () => {
	const code = [{ id: '2', url: 'https://code.test', events: [] }]
	/** A collection whose only row also has id 2, the collision a SQL adapter makes easy. */
	const payload = {
		find: () => Promise.resolve({ docs: [{ id: 2, url: 'https://row.test', events: [] }] }),
		logger: { error: () => undefined },
	} as never
	const resolve = (source?: string) =>
		resolveSubscriptionById({
			id: '2',
			source,
			codeSubscriptions: code,
			subscriptionsSlug: 'webhook-subscriptions',
			payload,
			req: { context: {} } as never,
		})

	/**
	 * A code subscription's id is whatever its author wrote, so it can equal a database id. The
	 * delivery records which registry it came from, and that decides.
	 */
	it('resolves in the registry the delivery recorded when the id exists in both', async () => {
		expect((await resolve('collection'))?.url).toBe('https://row.test')
		expect((await resolve('code'))?.url).toBe('https://code.test')
	})

	it('tries code first for a delivery written before the source was recorded', async () => {
		expect((await resolve())?.url).toBe('https://code.test')
	})

	it('does not fall through to the collection for a code subscription that is gone', async () => {
		const removed = await resolveSubscriptionById({
			id: '2',
			source: 'code',
			codeSubscriptions: [],
			subscriptionsSlug: 'webhook-subscriptions',
			payload,
			req: { context: {} } as never,
		})
		expect(removed).toBeNull()
	})
})

describe('fromCodeSubscription', () => {
	it('defaults enabled to true', () => {
		expect(fromCodeSubscription({ id: 'c', url: 'https://y', events: [] }).enabled).toBe(true)
		expect(
			fromCodeSubscription({ id: 'c', url: 'https://y', events: [], enabled: false }).enabled
		).toBe(false)
	})

	it('normalizes a bare base64 secret onto the whsec_ form', () => {
		const bare = generateSecret().slice(SECRET_PREFIX.length)
		expect(fromCodeSubscription({ id: 'c', url: 'u', events: [], secret: bare }).secrets).toEqual([
			`${SECRET_PREFIX}${bare}`,
		])
	})

	it('yields no secrets when none is configured', () => {
		expect(fromCodeSubscription({ id: 'c', url: 'u', events: [] }).secrets).toEqual([])
	})

	it('is never hidden: a code secret is already in the clear', () => {
		expect(fromCodeSubscription({ id: 'c', url: 'u', events: [] }).secretHidden).toBe(false)
	})
})

describe('matchSubscriptions', () => {
	const subs = [
		fromCodeSubscription({ id: 'a', url: 'u', events: ['posts.created'] }),
		fromCodeSubscription({ id: 'b', url: 'u', events: ['posts.updated'] }),
		fromCodeSubscription({ id: 'c', url: 'u', events: ['posts.created'], enabled: false }),
	]
	it('returns enabled subs listening for the event', () => {
		expect(matchSubscriptions(subs, 'posts.created').map((s) => s.id)).toEqual(['a'])
	})
})
