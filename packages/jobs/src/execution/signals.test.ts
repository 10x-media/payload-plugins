import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { installSignalHandlers, type SignalTarget } from './signals'

describe('installSignalHandlers', () => {
	it('invokes the handler once on the first signal and ignores later ones', () => {
		const target = new EventEmitter() as unknown as SignalTarget
		const handler = vi.fn()
		installSignalHandlers(['SIGTERM', 'SIGINT'], handler, target)
		;(target as unknown as EventEmitter).emit('SIGTERM')
		;(target as unknown as EventEmitter).emit('SIGINT')
		expect(handler).toHaveBeenCalledTimes(1)
		expect(handler).toHaveBeenCalledWith('SIGTERM')
	})

	it('cleanup removes the listeners', () => {
		const emitter = new EventEmitter()
		const target = emitter as unknown as SignalTarget
		const handler = vi.fn()
		const cleanup = installSignalHandlers(['SIGTERM'], handler, target)
		expect(emitter.listenerCount('SIGTERM')).toBe(1)
		cleanup()
		expect(emitter.listenerCount('SIGTERM')).toBe(0)
		emitter.emit('SIGTERM')
		expect(handler).not.toHaveBeenCalled()
	})
})
