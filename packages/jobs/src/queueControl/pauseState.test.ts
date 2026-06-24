import { describe, expect, it } from 'vitest'

import { applyPause, applyResume, emptyPauseState, isPaused } from './pauseState'

describe('pauseState', () => {
	it('pauses globally and per-queue (idempotent)', () => {
		expect(applyPause(emptyPauseState(), undefined)).toEqual({ global: true, queues: [] })
		expect(applyPause(emptyPauseState(), 'emails')).toEqual({ global: false, queues: ['emails'] })
		const once = applyPause(emptyPauseState(), 'emails')
		expect(applyPause(once, 'emails')).toEqual({ global: false, queues: ['emails'] })
	})

	it('resumes globally and per-queue', () => {
		expect(applyResume({ global: true, queues: ['a'] }, undefined)).toEqual({
			global: false,
			queues: ['a'],
		})
		expect(applyResume({ global: false, queues: ['a', 'b'] }, 'a')).toEqual({
			global: false,
			queues: ['b'],
		})
	})

	it('reports paused state (global covers every queue)', () => {
		expect(isPaused({ global: true, queues: [] }, 'anything')).toBe(true)
		expect(isPaused({ global: false, queues: ['a'] }, 'a')).toBe(true)
		expect(isPaused({ global: false, queues: ['a'] }, 'b')).toBe(false)
	})

	it('resume with all:true resets to empty state, clearing both global and per-queue pauses', () => {
		const state = applyPause(applyPause(emptyPauseState(), undefined), 'emails')
		// global=true, queues=['emails']
		const reset = applyResume(state, undefined, true)
		expect(reset).toEqual(emptyPauseState())
	})

	it('resume without all:true only clears global flag, leaving per-queue pauses intact', () => {
		const state = applyPause(applyPause(emptyPauseState(), undefined), 'emails')
		const partial = applyResume(state, undefined, false)
		expect(partial.global).toBe(false)
		expect(partial.queues).toContain('emails')
	})
})
