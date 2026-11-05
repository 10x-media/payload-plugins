import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackerWindow, VendorSwitch } from '../types'
import { createPlausibleSink, PLAUSIBLE_IGNORE_KEY } from './plausible'

const sink = () =>
	createPlausibleSink({
		slot: 'global',
		win: window as TrackerWindow,
		scripts: [],
		loadScript: () => Promise.resolve(),
	})

const to = (mode: VendorSwitch['mode'], refused = false): VendorSwitch => ({ mode, refused })

/** Plausible's script as loaded: it reads the flag as it is called, on a pageview. */
const install = (loaded: boolean) => {
	const flagOnCall: Array<[string, string | null]> = []
	const plausible = vi.fn((name: string) => {
		flagOnCall.push([name, window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)])
	})
	Object.defineProperty(window, 'plausible', {
		value: loaded ? Object.assign(plausible, { l: true }) : plausible,
		configurable: true,
	})
	return { plausible, flagOnCall }
}

beforeEach(() => {
	window.localStorage.clear()
})

afterEach(() => {
	Reflect.deleteProperty(window, 'plausible')
})

describe('the Plausible sink switching off', () => {
	it('sets the flag, then has the running script ignore a pageview so it sends no more engagement', () => {
		const { flagOnCall } = install(true)
		const plausible = sink()
		plausible.mode?.(to('full'))
		plausible.mode?.(to('off', true))
		expect(flagOnCall).toEqual([['pageview', 'true']])
	})

	it('calls nothing with storage blocked, where the pageview would be counted', () => {
		const { plausible } = install(true)
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('blocked')
		})
		sink().mode?.(to('off', true))
		expect(plausible).not.toHaveBeenCalled()
		vi.restoreAllMocks()
	})

	it('calls nothing on the queue stub, which has measured nothing yet', () => {
		const { plausible } = install(false)
		sink().mode?.(to('off', true))
		expect(window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)).toBe('true')
		expect(plausible).not.toHaveBeenCalled()
	})

	it('calls nothing on consent or without it, and clears the flag only in full', () => {
		window.localStorage.setItem(PLAUSIBLE_IGNORE_KEY, 'true')
		const { plausible } = install(true)
		const switched = sink()
		switched.mode?.(to('cookieless'))
		expect(window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)).toBe('true')
		switched.mode?.(to('full'))
		expect(window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY)).toBeNull()
		expect(plausible).not.toHaveBeenCalled()
	})
})
