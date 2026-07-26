import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { AnyActionDefinition } from './defineAction'
import type { ActionRegistry } from './registry'
import { runActionsForSubmission } from './task'

describe('runActionsForSubmission', () => {
	it('runs actions, isolates a failure, returns the results, and logs the failure', async () => {
		const boom: AnyActionDefinition = {
			type: 'boom',
			label: 'Boom',
			run: async () => {
				throw new Error('smtp down')
			},
		}
		const registry: ActionRegistry = new Map([['boom', boom]])
		const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
		const findByID = vi
			.fn()
			.mockResolvedValueOnce({ id: 's1', values: [], descriptors: [], locale: 'en' })
			.mockResolvedValueOnce({ id: 'f1', title: 'F', actions: [{ blockType: 'boom' }] })
		const payload = { findByID, logger } as unknown as Payload

		const results = await runActionsForSubmission({
			input: { formId: 'f1', submissionId: 's1' },
			registry,
			payload,
		})

		expect(results).toEqual([{ type: 'boom', ok: false, error: 'smtp down' }])
		expect(logger.error).toHaveBeenCalledTimes(1)
	})

	it('returns an empty list and logs nothing when the submission is missing', async () => {
		const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
		const findByID = vi.fn().mockResolvedValue(null)
		const payload = { findByID, logger } as unknown as Payload

		const results = await runActionsForSubmission({
			input: { formId: 'f1', submissionId: 's1' },
			registry: new Map(),
			payload,
		})

		expect(results).toEqual([])
		expect(logger.error).not.toHaveBeenCalled()
	})

	const submissionThenForm = (form: Record<string, unknown>) =>
		vi
			.fn()
			.mockResolvedValueOnce({ id: 's1', values: [], descriptors: [], locale: 'en' })
			.mockResolvedValueOnce({ id: 'f1', title: 'F', ...form })

	it('prunes the submission after the pass when the form opts out of persistence', async () => {
		const del = vi.fn().mockResolvedValue(undefined)
		const payload = {
			findByID: submissionThenForm({ actions: [], persistSubmissions: false }),
			delete: del,
			logger: { error: vi.fn() },
		} as unknown as Payload
		await runActionsForSubmission({
			input: { formId: 'f1', submissionId: 's1' },
			registry: new Map(),
			payload,
		})
		expect(del).toHaveBeenCalledWith(
			expect.objectContaining({ collection: 'form-submissions', id: 's1', overrideAccess: true })
		)
	})

	it('keeps the submission when the form persists (the default)', async () => {
		const del = vi.fn()
		const payload = {
			findByID: submissionThenForm({ actions: [] }),
			delete: del,
			logger: { error: vi.fn() },
		} as unknown as Payload
		await runActionsForSubmission({
			input: { formId: 'f1', submissionId: 's1' },
			registry: new Map(),
			payload,
		})
		expect(del).not.toHaveBeenCalled()
	})

	it('prunes even when an action fails (delete after the whole pass)', async () => {
		const boom: AnyActionDefinition = {
			type: 'boom',
			label: 'Boom',
			run: async () => {
				throw new Error('x')
			},
		}
		const del = vi.fn().mockResolvedValue(undefined)
		const payload = {
			findByID: submissionThenForm({ actions: [{ blockType: 'boom' }], persistSubmissions: false }),
			delete: del,
			logger: { error: vi.fn() },
		} as unknown as Payload
		await runActionsForSubmission({
			input: { formId: 'f1', submissionId: 's1' },
			registry: new Map([['boom', boom]]),
			payload,
		})
		expect(del).toHaveBeenCalledOnce()
	})
})
