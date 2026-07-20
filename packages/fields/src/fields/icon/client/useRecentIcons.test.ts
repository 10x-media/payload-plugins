// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { RECENT_ICONS_STORAGE_KEY, useRecentIcons } from './useRecentIcons'

describe('useRecentIcons', () => {
	beforeEach(() => window.localStorage.clear())

	it('starts empty and records per-library, most recent first, deduplicated', () => {
		const { result } = renderHook(() => useRecentIcons('lucide'))
		expect(result.current.recent).toEqual([])
		act(() => result.current.addRecent('house'))
		act(() => result.current.addRecent('heart'))
		act(() => result.current.addRecent('house'))
		expect(result.current.recent).toEqual(['house', 'heart'])
	})

	it('caps at 24 entries', () => {
		const { result } = renderHook(() => useRecentIcons('lucide'))
		act(() => {
			for (let index = 0; index < 30; index += 1) result.current.addRecent(`icon-${index}`)
		})
		expect(result.current.recent).toHaveLength(24)
		expect(result.current.recent[0]).toBe('icon-29')
	})

	it('isolates libraries under one storage key', () => {
		const lucide = renderHook(() => useRecentIcons('lucide'))
		act(() => lucide.result.current.addRecent('house'))
		const radix = renderHook(() => useRecentIcons('radix'))
		expect(radix.result.current.recent).toEqual([])
		const stored = JSON.parse(window.localStorage.getItem(RECENT_ICONS_STORAGE_KEY) ?? '{}')
		expect(stored.lucide).toEqual(['house'])
	})
})
