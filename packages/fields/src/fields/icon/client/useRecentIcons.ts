'use client'

import { useCallback, useState } from 'react'

export const RECENT_ICONS_STORAGE_KEY = '10x-fields:icon-recent'
const MAX_RECENT = 24

type RecentMap = Record<string, string[]>

const readMap = (): RecentMap => {
	if (typeof window === 'undefined') return {}
	try {
		return JSON.parse(window.localStorage.getItem(RECENT_ICONS_STORAGE_KEY) ?? '{}') as RecentMap
	} catch {
		return {}
	}
}

export const useRecentIcons = (
	library: string
): { addRecent: (name: string) => void; recent: string[] } => {
	const [recent, setRecent] = useState<string[]>(() => readMap()[library] ?? [])

	const addRecent = useCallback(
		(name: string) => {
			const map = readMap()
			const next = [name, ...(map[library] ?? []).filter((entry) => entry !== name)].slice(
				0,
				MAX_RECENT
			)
			map[library] = next
			try {
				window.localStorage.setItem(RECENT_ICONS_STORAGE_KEY, JSON.stringify(map))
			} catch {
				// storage full or blocked: recents silently stop persisting
			}
			setRecent(next)
		},
		[library]
	)

	return { addRecent, recent }
}
