import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { createCollectionProbe, PROBE_MEMO_MS, type ProbeRow, probeEpoch, versionOf } from './probe'

const row = (id: string, updatedAt: string, over: Partial<ProbeRow> = {}): ProbeRow => ({
	id,
	updatedAt,
	enabled: true,
	provider: 'plausible',
	scope: 'tenant-a',
	...over,
})

const AT = '2026-10-07T12:00:00.000Z'
const LATER = '2026-10-07T12:00:01.000Z'

describe('probeEpoch', () => {
	it('is the same for the same rows in any order', () => {
		const rows = [row('1', AT), row('2', AT), row('10', LATER)]
		expect(probeEpoch([...rows].reverse())).toBe(probeEpoch(rows))
		expect(probeEpoch([rows[2], rows[0], rows[1]] as ProbeRow[])).toBe(probeEpoch(rows))
	})

	it('moves when a document is saved again, switched off, moved, added or removed', () => {
		const rows = [row('1', AT), row('2', AT)]
		const epoch = probeEpoch(rows)
		expect(probeEpoch([row('1', LATER), row('2', AT)])).not.toBe(epoch)
		expect(probeEpoch([row('1', AT, { enabled: false }), row('2', AT)])).not.toBe(epoch)
		expect(probeEpoch([row('1', AT, { scope: 'tenant-b' }), row('2', AT)])).not.toBe(epoch)
		expect(probeEpoch([...rows, row('3', AT)])).not.toBe(epoch)
		expect(probeEpoch([row('1', AT)])).not.toBe(epoch)
	})

	it('is a fixed-length token', () => {
		expect(probeEpoch([])).toMatch(/^[A-Za-z0-9_-]{43}$/)
	})
})

describe('versionOf', () => {
	it('writes every stored date form as one ISO instant, and nothing as empty', () => {
		expect(versionOf(new Date(AT))).toBe(AT)
		expect(versionOf(AT)).toBe(AT)
		expect(versionOf('2026-10-07T14:00:00.000+02:00')).toBe(AT)
		expect(versionOf(Date.parse(AT))).toBe(AT)
		expect(versionOf(undefined)).toBe('')
		expect(versionOf('not a date')).toBe('')
	})
})

type FindArgs = { req: unknown; select: Record<string, unknown>; where?: unknown }

/** An instance whose `payload.db.find` answers with the documents `rows` holds right now. */
const instance = (rows: { current: Array<Record<string, unknown>> }) => {
	const find = vi.fn(async (_args: FindArgs) => ({ docs: rows.current }))
	const payload = {
		collections: { 'analytics-providers': {} },
		db: { find },
	} as unknown as Payload
	return { payload, find }
}

const stored = (id: number, updatedAt: string) => ({
	id,
	updatedAt,
	enabled: true,
	provider: 'umami',
	scope: 'tenant-a',
})

describe('createCollectionProbe', () => {
	const setup = () => {
		const rows = { current: [stored(1, AT)] }
		const { payload, find } = instance(rows)
		let now = 0
		const clock = { advance: (ms: number) => (now += ms) }
		const probe = createCollectionProbe({
			payload,
			slug: 'analytics-providers',
			scopeField: 'scope',
			where: (scope) => ({ scope: { equals: scope } }),
			provider: true,
			now: () => now,
		})
		return { probe, find, rows, clock }
	}

	it('reads ids, save times, the switch, the provider and the scope, never a credential', async () => {
		const { probe, find } = setup()
		const { rows } = await probe.read('tenant-a')
		expect(rows).toEqual([
			{ id: '1', updatedAt: AT, enabled: true, provider: 'umami', scope: 'tenant-a' },
		])
		const args = find.mock.calls[0]?.[0]
		expect(args?.select).toEqual({ updatedAt: true, enabled: true, scope: true, provider: true })
		expect(args?.where).toEqual({ scope: { equals: 'tenant-a' } })
	})

	// A request with no `transactionID` is what keeps the read off any transaction the caller holds.
	it('reads with a request carrying no transaction', async () => {
		const { probe, find } = setup()
		await probe.read('tenant-a')
		expect(find.mock.calls[0]?.[0]?.req).toEqual({})
	})

	it('answers from memory inside the window and asks again after it', async () => {
		const { probe, find, rows, clock } = setup()
		const first = await probe.read('tenant-a')
		rows.current = [stored(1, LATER)]
		clock.advance(PROBE_MEMO_MS - 1)
		expect((await probe.read('tenant-a')).epoch).toBe(first.epoch)
		clock.advance(1)
		expect((await probe.read('tenant-a')).epoch).not.toBe(first.epoch)
		expect(find).toHaveBeenCalledTimes(2)
	})

	it('memoizes each scope on its own, the empty scope and null as one', async () => {
		const { probe, find } = setup()
		await probe.read('tenant-a')
		await probe.read('tenant-b')
		await probe.read(null)
		await probe.read('')
		await probe.read(undefined)
		expect(find).toHaveBeenCalledTimes(3)
	})

	it('asks on every read of an expedited scope for one window, then memoizes again', async () => {
		const { probe, find, clock } = setup()
		await probe.read('tenant-a')
		await probe.read('tenant-b')
		probe.expedite(['tenant-a'])
		await probe.read('tenant-a')
		await probe.read('tenant-a')
		await probe.read('tenant-b')
		expect(find).toHaveBeenCalledTimes(4)
		clock.advance(PROBE_MEMO_MS)
		await probe.read('tenant-a')
		await probe.read('tenant-a')
		expect(find).toHaveBeenCalledTimes(5)
	})

	it('keeps no failure, so the next read asks again', async () => {
		const { probe, find } = setup()
		find.mockRejectedValueOnce(new Error('db down'))
		await expect(probe.read('tenant-a')).rejects.toThrow('db down')
		await expect(probe.read('tenant-a')).resolves.toMatchObject({ rows: [{ id: '1' }] })
	})

	it('selects every document for every scope without a where clause, and rows carry no provider', async () => {
		const rows = { current: [{ id: 'g1', updatedAt: AT, enabled: false }] }
		const { payload, find } = instance(rows)
		const probe = createCollectionProbe({
			payload,
			slug: 'analytics-providers',
			scopeField: 'scope',
		})
		expect((await probe.read('tenant-a')).rows).toEqual([
			{ id: 'g1', updatedAt: AT, enabled: false, scope: null },
		])
		expect(find.mock.calls[0]?.[0]?.where).toBeUndefined()
	})

	it('refuses a collection the instance does not register', async () => {
		const probe = createCollectionProbe({
			payload: { collections: {}, db: { find: vi.fn() } } as unknown as Payload,
			slug: 'analytics-providers',
			scopeField: 'scope',
		})
		await expect(probe.read(null)).rejects.toThrow('"analytics-providers"')
	})
})
