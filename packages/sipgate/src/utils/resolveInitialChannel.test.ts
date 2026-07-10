import { describe, expect, it } from 'vitest'
import { resolveInitialChannel } from './resolveInitialChannel'

const ch = (id: string) => ({ id, name: id })

describe('resolveInitialChannel', () => {
	it('returns undefined when no channels and no default', () => {
		expect(resolveInitialChannel(undefined, undefined)).toBeUndefined()
		expect(resolveInitialChannel([], undefined)).toBeUndefined()
	})

	it('returns defaultChannelId when channel list is empty', () => {
		expect(resolveInitialChannel([], 'ch-default')).toBe('ch-default')
		expect(resolveInitialChannel(undefined, 'ch-default')).toBe('ch-default')
	})

	it('prefers the defaultChannelId when it is in the channel list', () => {
		const channels = [ch('ch-1'), ch('ch-2'), ch('ch-default')]
		expect(resolveInitialChannel(channels, 'ch-default')).toBe('ch-default')
	})

	it('prefers default over first channel even when default is not the first entry', () => {
		const channels = [ch('ch-1'), ch('ch-2'), ch('ch-3')]
		expect(resolveInitialChannel(channels, 'ch-3')).toBe('ch-3')
	})

	it('falls back to the first channel when default is not in the list', () => {
		const channels = [ch('ch-1'), ch('ch-2')]
		expect(resolveInitialChannel(channels, 'ch-missing')).toBe('ch-1')
	})

	it('returns the first channel when there is no default at all', () => {
		const channels = [ch('ch-1'), ch('ch-2')]
		expect(resolveInitialChannel(channels, undefined)).toBe('ch-1')
	})
})
