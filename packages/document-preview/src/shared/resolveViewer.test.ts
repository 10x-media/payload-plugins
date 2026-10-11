import { describe, expect, it } from 'vitest'

import { isMimePattern, matchViewer, resolveViewer } from './resolveViewer'

describe('isMimePattern', () => {
	it('accepts exact mimes and type wildcards', () => {
		expect(isMimePattern('video/mp4')).toBe(true)
		expect(isMimePattern('video/*')).toBe(true)
		expect(isMimePattern('image/svg+xml')).toBe(true)
		expect(
			isMimePattern('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
		).toBe(true)
	})

	it('rejects catch-alls, uppercase and malformed keys', () => {
		expect(isMimePattern('*')).toBe(false)
		expect(isMimePattern('*/*')).toBe(false)
		expect(isMimePattern('Video/MP4')).toBe(false)
		expect(isMimePattern('video')).toBe(false)
		expect(isMimePattern('video/mp4/x')).toBe(false)
	})
})

describe('matchViewer', () => {
	it('prefers the exact mime over the wildcard', () => {
		expect(matchViewer({ 'video/*': 'any', 'video/mp4': 'mp4' }, 'video/mp4')).toBe('mp4')
		expect(matchViewer({ 'video/*': 'any', 'video/mp4': 'mp4' }, 'video/webm')).toBe('any')
	})

	it('finds nothing for an empty mime or map', () => {
		expect(matchViewer({ 'video/*': 'any' }, '')).toBeUndefined()
		expect(matchViewer(undefined, 'video/mp4')).toBeUndefined()
	})
})

describe('resolveViewer', () => {
	const builtIn = { 'video/*': 'builtin-video', 'video/mp4': 'builtin-mp4' }

	it('searches each layer in full before the next', () => {
		expect(resolveViewer([undefined, { 'video/*': 'host' }, builtIn], 'video/mp4')).toBe('host')
	})

	it('lets a collection layer beat the global one', () => {
		expect(
			resolveViewer(
				[{ 'video/mp4': 'collection' }, { 'video/mp4': 'global' }, builtIn],
				'video/mp4'
			)
		).toBe('collection')
	})

	it('falls through to the built-ins, then to nothing', () => {
		expect(resolveViewer([{}, {}, builtIn], 'video/webm')).toBe('builtin-video')
		expect(resolveViewer([{}, {}, builtIn], 'application/zip')).toBeUndefined()
	})
})
