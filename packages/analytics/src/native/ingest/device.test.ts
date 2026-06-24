import { describe, expect, it } from 'vitest'
import { classifyDevice } from './device'

describe('classifyDevice', () => {
	it('classifies an iPhone user-agent as mobile', () => {
		expect(
			classifyDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148')
		).toBe('mobile')
	})

	it('classifies an Android phone (has Mobile) as mobile', () => {
		expect(classifyDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36')).toBe(
			'mobile'
		)
	})

	it('classifies an iPad as tablet', () => {
		expect(classifyDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/604.1')).toBe(
			'tablet'
		)
	})

	it('classifies an Android tablet (no Mobile token) as tablet', () => {
		expect(classifyDevice('Mozilla/5.0 (Linux; Android 14; SM-X200) Safari/537.36')).toBe('tablet')
	})

	it('classifies a desktop user-agent as desktop', () => {
		expect(
			classifyDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36')
		).toBe('desktop')
	})

	it('defaults an empty user-agent to desktop', () => {
		expect(classifyDevice('')).toBe('desktop')
	})
})
