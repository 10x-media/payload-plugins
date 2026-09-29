import { describe, expect, it } from 'vitest'

import { mergeGateResults, withGates } from './gates'
import { deferOnInterrupt, policyFor, resolveDeferSlugs } from './policy'
import { type InterruptionRecord, interruptionStep, interruptionUpdate } from './records'

const until = new Date('2030-01-01T00:00:00.000Z')
const later = new Date('2030-06-01T00:00:00.000Z')

describe('mergeGateResults', () => {
	it('is open with no verdicts', () => {
		expect(mergeGateResults([null])).toEqual({ by: null, global: false, queues: [], until: null })
	})

	it('unions queues and keeps the latest known end', () => {
		const merged = mergeGateResults([
			{ by: 'a', paused: ['emails'], until },
			{ by: 'b', paused: ['emails', 'search'], until: later },
		])
		expect(merged).toEqual({ by: 'a', global: false, queues: ['emails', 'search'], until: later })
	})

	it('forgets the end when any pausing gate does not know it', () => {
		const merged = mergeGateResults([{ paused: 'all', until }, { paused: ['x'] }])
		expect(merged.global).toBe(true)
		expect(merged.until).toBeNull()
	})

	it('pauses everything when a gate failed', () => {
		expect(mergeGateResults(['error']).global).toBe(true)
	})

	it('widens the manual pause without narrowing it', () => {
		const state = withGates(
			{ global: false, queues: ['manual'] },
			{ by: null, global: false, queues: ['gated'], until: null }
		)
		expect(state).toEqual({ global: false, queues: ['manual', 'gated'] })
	})
})

describe('interruption policy', () => {
	const handler = () => ({ output: {} })
	const tasks = [
		deferOnInterrupt({ slug: 'marked', handler }),
		{ slug: 'listed', handler },
		{ slug: 'plain', handler },
	]
	const workflows = [deferOnInterrupt({ slug: 'flow', handler }), { slug: 'other', handler }]
	const defer = resolveDeferSlugs(tasks, workflows, ['listed'])

	it('fails unless opted in', () => {
		expect(policyFor({ taskSlug: 'plain' }, defer)).toBe('fail')
		expect(policyFor({ taskSlug: 'marked' }, defer)).toBe('defer')
		expect(policyFor({ taskSlug: 'listed' }, defer)).toBe('defer')
	})

	it("applies a workflow's policy to its tasks", () => {
		expect(policyFor({ taskSlug: 'marked', workflowSlug: 'other' }, defer)).toBe('fail')
		expect(policyFor({ taskSlug: 'plain', workflowSlug: 'flow' }, defer)).toBe('defer')
	})

	it('needs a function handler to mark', () => {
		expect(() => deferOnInterrupt({ slug: 'byPath', handler: './task#run' })).toThrow(
			/function handler/
		)
	})
})

describe('interruptionUpdate', () => {
	const record: InterruptionRecord = {
		by: 'lock',
		logIds: ['old-failed', 'old-ok'],
		outcome: 'defer',
		reason: 'locked',
		recordedAt: 0,
		totalTried: 2,
		until,
	}
	const log = [
		{ id: 'old-failed', state: 'failed' },
		{ id: 'old-ok', state: 'succeeded' },
		{ id: 'new-ok', state: 'succeeded' },
		{ id: 'new-failed', state: 'failed' },
	]

	it("defers: restores tries and drops only this attempt's failures", () => {
		const data = interruptionUpdate(record, { log })
		expect(data).toMatchObject({
			deferredBy: 'lock',
			error: null,
			hasError: false,
			processing: false,
			totalTried: 2,
			waitUntil: until.toISOString(),
		})
		expect((data.log as typeof log).map((entry) => entry.id)).toEqual([
			'old-failed',
			'old-ok',
			'new-ok',
		])
	})

	it('leaves the log alone when nothing failed', () => {
		expect(interruptionUpdate(record, { log: log.slice(0, 3) })).not.toHaveProperty('log')
	})

	it('fails for good with the reason', () => {
		expect(interruptionUpdate({ ...record, outcome: 'fail' }, { log })).toEqual({
			error: {
				interruptedBy: 'lock',
				message: 'Interrupted by lock',
				name: 'JobInterrupted',
				reason: 'locked',
			},
			hasError: true,
			processing: false,
			waitUntil: null,
		})
	})
})

describe('interruptionStep', () => {
	const record: InterruptionRecord = {
		by: 'lock',
		logIds: [],
		outcome: 'defer',
		reason: 'locked',
		recordedAt: 0,
		totalTried: 2,
		until,
	}

	it('applies to the settled attempt it recorded', () => {
		expect(interruptionStep(record, { processing: false, totalTried: 3 })).toBe('apply')
	})

	it('waits while Payload has not written the attempt yet', () => {
		expect(interruptionStep(record, { processing: true, totalTried: 2 })).toBe('wait')
	})

	it('drops when another node claimed the job again', () => {
		expect(interruptionStep(record, { processing: true, totalTried: 3 })).toBe('drop')
		expect(interruptionStep(record, { processing: false, totalTried: 4 })).toBe('drop')
	})

	it('drops a completed or missing job', () => {
		expect(interruptionStep(record, { completedAt: 'x', totalTried: 3 })).toBe('drop')
		expect(interruptionStep(record, null)).toBe('drop')
	})
})
