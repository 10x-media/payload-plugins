import { describe, expect, it, vi } from 'vitest'
import { dispatchActions } from './dispatch'
import type { ActionRegistry } from './registry'
import { ACTIONS_TASK_SLUG } from './task'

const makeRegistry = (): ActionRegistry => new Map()

const makeRecorderRegistry = (): { registry: ActionRegistry; ran: string[] } => {
	const ran: string[] = []
	const registry: ActionRegistry = new Map([
		[
			'recorder',
			{
				type: 'recorder',
				label: 'Recorder',
				run: async () => {
					ran.push('recorder')
				},
			},
		],
	])
	return { registry, ran }
}

describe('dispatchActions', () => {
	describe('hasRunner true (queued path)', () => {
		it('calls payload.jobs.queue with the correct shape and returns without running inline', async () => {
			const queue = vi.fn().mockResolvedValue(undefined)
			const payload = { jobs: { queue } } as never
			const req = {} as never
			const { registry } = makeRecorderRegistry()

			await dispatchActions({
				actions: [{ blockType: 'recorder' }],
				formId: 'form-1',
				submissionId: 'sub-42',
				registry,
				payload,
				req,
				hasRunner: true,
			})

			expect(queue).toHaveBeenCalledOnce()
			expect(queue).toHaveBeenCalledWith({
				task: ACTIONS_TASK_SLUG,
				input: { formId: 'form-1', submissionId: 'sub-42' },
				req,
			})
		})

		it('does not run actions inline when queued path is taken', async () => {
			const queue = vi.fn().mockResolvedValue(undefined)
			const payload = { jobs: { queue } } as never
			const { registry, ran } = makeRecorderRegistry()

			await dispatchActions({
				actions: [{ blockType: 'recorder' }],
				formId: 'form-1',
				submissionId: 'sub-42',
				registry,
				payload,
				hasRunner: true,
			})

			expect(ran).toHaveLength(0)
		})
	})

	describe('hasRunner false (inline path)', () => {
		it('runs actions inline and does not call queue', async () => {
			const queue = vi.fn()
			const { registry, ran } = makeRecorderRegistry()

			const payload = {
				jobs: { queue },
				logger: { error: vi.fn() },
				findByID: vi.fn().mockImplementation(({ collection }: { collection: string }) => {
					if (collection === 'forms') {
						return Promise.resolve({ id: 'form-2', actions: [{ blockType: 'recorder' }] })
					}
					return Promise.resolve({ id: 'sub-99', values: [], descriptors: [] })
				}),
			} as never

			await dispatchActions({
				actions: [{ blockType: 'recorder' }],
				formId: 'form-2',
				submissionId: 'sub-99',
				registry,
				payload,
				hasRunner: false,
				deadlineMs: 1_000,
			})

			expect(ran).toEqual(['recorder'])
			expect(queue).not.toHaveBeenCalled()
		})
	})

	describe('edge cases', () => {
		it('returns immediately when the actions list is empty', async () => {
			const queue = vi.fn()
			const payload = { jobs: { queue } } as never

			await dispatchActions({
				actions: [],
				formId: 'form-1',
				submissionId: 'sub-1',
				registry: makeRegistry(),
				payload,
				hasRunner: true,
			})

			expect(queue).not.toHaveBeenCalled()
		})

		it('returns immediately when actions is null/undefined', async () => {
			const queue = vi.fn()
			const payload = { jobs: { queue } } as never

			await dispatchActions({
				actions: null,
				formId: 'form-1',
				submissionId: 'sub-1',
				registry: makeRegistry(),
				payload,
				hasRunner: true,
			})

			expect(queue).not.toHaveBeenCalled()
		})

		it('falls back to inline when hasRunner is true but queue is unavailable', async () => {
			const { registry, ran } = makeRecorderRegistry()

			const payload = {
				jobs: {},
				logger: { error: vi.fn() },
				findByID: vi.fn().mockImplementation(({ collection }: { collection: string }) => {
					if (collection === 'forms') {
						return Promise.resolve({ id: 'form-1', actions: [{ blockType: 'recorder' }] })
					}
					return Promise.resolve({ id: 'sub-1', values: [], descriptors: [] })
				}),
			} as never

			await dispatchActions({
				actions: [{ blockType: 'recorder' }],
				formId: 'form-1',
				submissionId: 'sub-1',
				registry,
				payload,
				hasRunner: true,
				deadlineMs: 1_000,
			})

			expect(ran).toEqual(['recorder'])
		})
	})

	describe('no actions', () => {
		it('returns early when a persisting form has no actions', async () => {
			const queue = vi.fn()
			const payload = { jobs: { queue } } as never
			await dispatchActions({
				actions: [],
				formId: 'form-1',
				submissionId: 'sub-1',
				registry: new Map(),
				payload,
				hasRunner: true,
			})
			expect(queue).not.toHaveBeenCalled()
		})

		it('runs the completion for an action-less form that opts out of persistence (to prune)', async () => {
			const queue = vi.fn().mockResolvedValue(undefined)
			const payload = { jobs: { queue } } as never
			await dispatchActions({
				actions: [],
				formId: 'form-1',
				submissionId: 'sub-1',
				registry: new Map(),
				payload,
				hasRunner: true,
				persistSubmissions: false,
			})
			expect(queue).toHaveBeenCalledOnce()
		})
	})
})
