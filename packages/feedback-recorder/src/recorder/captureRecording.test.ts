import { describe, expect, it } from 'vitest'
import { displayMediaOptions } from './captureRecording'

describe('the screen share request', () => {
	it('offers the current tab in the picker', () => {
		expect(displayMediaOptions.selfBrowserSurface).toBe('include')
	})

	it('asks for the screen with its audio', () => {
		expect(displayMediaOptions.video).toEqual({ frameRate: 30 })
		expect(displayMediaOptions.audio).toBe(true)
	})
})
