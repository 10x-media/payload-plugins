'use client'

import { Gutter, useConfig } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

import {
	compareTargetEntries,
	targetKeysForDoc,
	type WikiTargetEntry,
} from '../../shared/targetKeys'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { StarIcon } from '../icons'
import { TargetChips } from '../TargetChips/TargetChips'
import { useWikiTargets } from '../WikiProvider/WikiProvider'
import './list-extras.css'

type FindResponse = {
	docs?: Array<Record<string, unknown> & { id: number | string }>
}

/**
 * Featured guides as cards on the wiki pages list, honoring the configured
 * order. Cards open the wiki reading view when it is enabled, the edit view
 * otherwise.
 *
 * Wrapped in `Gutter` because the list slots render outside the list's own
 * gutter: without it the band sits 60px to the left of every other thing on the
 * page. Which slot it lands in is the `featured.slot` option.
 */
export const WikiFeaturedList = () => {
	const { t } = useTranslation()
	const { config } = useConfig()
	const { locale, pagesSlug, wikiViewEnabled } = useWikiTargets()
	const [entries, setEntries] = useState<WikiTargetEntry[]>([])

	useEffect(() => {
		let cancelled = false
		const base = `${config.serverURL ?? ''}${config.routes.api}`
		const params = new URLSearchParams({
			depth: '0',
			draft: 'false',
			limit: '24',
			'where[_status][equals]': 'published',
			'where[featured][equals]': 'true',
		})
		if (locale) {
			params.set('locale', locale)
		}
		void fetch(`${base}/${pagesSlug}?${params.toString()}`, { credentials: 'include' })
			.then((response) => (response.ok ? (response.json() as Promise<FindResponse>) : null))
			.then((body) => {
				if (cancelled || !body?.docs) {
					return
				}
				const featured = body.docs
					.map(
						(doc): WikiTargetEntry => ({
							featured: doc.featured === true,
							featuredOrder: typeof doc.featuredOrder === 'number' ? doc.featuredOrder : null,
							id: doc.id,
							slug: typeof doc.slug === 'string' ? doc.slug : null,
							summary: typeof doc.summary === 'string' ? doc.summary : null,
							targetKeys: targetKeysForDoc(doc.targets),
							title: typeof doc.title === 'string' ? doc.title : null,
						})
					)
					.sort(compareTargetEntries)
				setEntries(featured)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [config.routes.api, config.serverURL, locale, pagesSlug])

	if (entries.length === 0) {
		return null
	}

	const hrefFor = (entry: WikiTargetEntry) =>
		wikiViewEnabled && entry.slug
			? `${config.routes.admin}/wiki/${entry.slug}`
			: `${config.routes.admin}/collections/${pagesSlug}/${entry.id}`

	return (
		<Gutter className="wiki-featured">
			<h2 className="wiki-featured__heading">{t(keys.wikiFeaturedHeading)}</h2>
			<div className="wiki-featured__cards">
				{entries.map((entry) => (
					<a className="wiki-featured__card" href={hrefFor(entry)} key={entry.id}>
						<span className="wiki-featured__card-title">
							<StarIcon size="small" />
							{entry.title}
						</span>
						{entry.summary ? (
							<span className="wiki-featured__card-summary">{entry.summary}</span>
						) : null}
						<TargetChips
							className="wiki-featured__card-chips"
							limit={3}
							targetKeys={entry.targetKeys}
						/>
					</a>
				))}
			</div>
		</Gutter>
	)
}
