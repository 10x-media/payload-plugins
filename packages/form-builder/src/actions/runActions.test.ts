import { describe, expect, it, vi } from 'vitest'
import type { ActionRegistry } from './registry'
import { runActions } from './runActions'

const makeMockCtx = () => ({
	form: { id: '1' as string, title: 'Test' },
	submissionId: 'sub-1' as string,
	values: [] as never[],
	descriptors: [] as never[],
	context: null,
	payload: {} as never,
	locale: 'en',
	t: (key: string) => key,
})

describe('runActions', () => {
	it('returns empty array when no actions given', async () => {
		const registry: ActionRegistry = new Map()
		const results = await runActions({ ...makeMockCtx(), actions: [], registry })
		expect(results).toEqual([])
	})

	it('skips actions whose blockType is not in the registry', async () => {
		const registry: ActionRegistry = new Map()
		const results = await runActions({
			...makeMockCtx(),
			actions: [{ blockType: 'unknown' }],
			registry,
		})
		expect(results).toEqual([])
	})

	it('returns ok:true for a successful action', async () => {
		const run = vi.fn().mockResolvedValue(undefined)
		const registry: ActionRegistry = new Map([['noop', { type: 'noop', label: 'Noop', run }]])
		const results = await runActions({
			...makeMockCtx(),
			actions: [{ blockType: 'noop' }],
			registry,
		})
		expect(results).toEqual([{ type: 'noop', ok: true }])
		expect(run).toHaveBeenCalledOnce()
	})

	it('isolates a throwing action and continues running subsequent actions', async () => {
		const failRun = vi.fn().mockRejectedValue(new Error('boom'))
		const succeedRun = vi.fn().mockResolvedValue(undefined)
		const registry: ActionRegistry = new Map([
			['fail', { type: 'fail', label: 'Fail', run: failRun }],
			['succeed', { type: 'succeed', label: 'Succeed', run: succeedRun }],
		])

		const results = await runActions({
			...makeMockCtx(),
			actions: [{ blockType: 'fail' }, { blockType: 'succeed' }],
			registry,
		})

		expect(results).toEqual([
			{ type: 'fail', ok: false, error: 'boom' },
			{ type: 'succeed', ok: true },
		])
		expect(succeedRun).toHaveBeenCalledOnce()
	})

	it('captures non-Error throws as string', async () => {
		const registry: ActionRegistry = new Map([
			['bad', { type: 'bad', label: 'Bad', run: vi.fn().mockRejectedValue('raw string error') }],
		])
		const results = await runActions({
			...makeMockCtx(),
			actions: [{ blockType: 'bad' }],
			registry,
		})
		expect(results).toEqual([{ type: 'bad', ok: false, error: 'raw string error' }])
	})

	it('passes the full instance as config to the action run', async () => {
		const run = vi.fn().mockResolvedValue(undefined)
		const registry: ActionRegistry = new Map([
			['withConfig', { type: 'withConfig', label: 'WithConfig', run }],
		])
		await runActions({
			...makeMockCtx(),
			actions: [{ blockType: 'withConfig', to: 'team@x.com' }],
			registry,
		})
		expect(run).toHaveBeenCalledWith(
			expect.objectContaining({ config: { blockType: 'withConfig', to: 'team@x.com' } })
		)
	})
})
