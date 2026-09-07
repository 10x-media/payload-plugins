'use client'

import { useConfig } from '@payloadcms/ui'
import { useQueries } from '@tanstack/react-query'
import { createContext, use, useMemo } from 'react'

import type { BadgeConfig, Manifest } from '../types'

export type BadgeValues = Record<string, number | string | undefined>

const BadgeContext = createContext<BadgeValues>({})

/**
 * Publishes badge values from the host, keyed by item slug. Merges with any provider above it,
 * with the inner one winning, so a host can override a value the plugin fetched itself.
 *
 * Mount it inside `admin.components.providers` and feed it whatever you already track.
 */
export const BadgeProvider = ({
	children,
	values,
}: {
	children?: React.ReactNode
	values: BadgeValues
}) => {
	const parent = use(BadgeContext)
	const merged = useMemo(() => ({ ...parent, ...values }), [parent, values])
	return <BadgeContext value={merged}>{children}</BadgeContext>
}

/** The badge value for one item slug, whatever produced it. */
export const useSettingsBadge = (slug: string): number | string | undefined =>
	use(BadgeContext)[slug]

type Fetchable = { config: BadgeConfig; slug: string }

const readPath = (data: unknown, path: string): unknown =>
	path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)?.[key], data)

/**
 * Fetches the badges the plugin can resolve on its own (`api` and `collection-count`) and
 * publishes them beneath any host `BadgeProvider`, so a host value still wins.
 *
 * One query per badge, cached for a minute: a rail badge is a hint, not a live counter, and
 * refetching every one of them on every panel open would be a lot of requests for a number.
 */
export const InternalBadgeProvider = ({
	children,
	manifests,
}: {
	children?: React.ReactNode
	manifests: Record<string, Manifest>
}) => {
	const {
		config: {
			routes: { api: apiRoute },
			serverURL,
		},
	} = useConfig()

	const fetchable = useMemo<Fetchable[]>(() => {
		const found = new Map<string, Fetchable>()
		for (const manifest of Object.values(manifests)) {
			for (const group of manifest.groups) {
				for (const item of group.items) {
					if (item.badge && item.badge.type !== 'provider') {
						found.set(item.slug, { config: item.badge, slug: item.slug })
					}
				}
			}
		}
		return [...found.values()]
	}, [manifests])

	const results = useQueries({
		queries: fetchable.map(({ config, slug }) => ({
			queryFn: async () => {
				const url =
					config.type === 'api'
						? config.endpoint.startsWith('http')
							? config.endpoint
							: `${serverURL || ''}${config.endpoint}`
						: `${serverURL || ''}${apiRoute}/${slug}?limit=0`
				const responseKey = config.type === 'api' ? config.responseKey : 'totalDocs'

				const response = await fetch(url, {
					credentials: 'include',
					method: config.type === 'api' ? (config.method ?? 'GET') : 'GET',
				})
				if (!response.ok) {
					return null
				}
				const value = readPath(await response.json(), responseKey)
				return typeof value === 'number' || typeof value === 'string' ? value : null
			},
			queryKey: ['settings-overlay', 'badge', slug] as const,
			staleTime: 60 * 1000,
		})),
	})

	const values = useMemo<BadgeValues>(() => {
		const out: BadgeValues = {}
		fetchable.forEach(({ slug }, index) => {
			const value = results[index]?.data
			if (value !== null && value !== undefined) {
				out[slug] = value
			}
		})
		return out
	}, [fetchable, results])

	return <BadgeProvider values={values}>{children}</BadgeProvider>
}
