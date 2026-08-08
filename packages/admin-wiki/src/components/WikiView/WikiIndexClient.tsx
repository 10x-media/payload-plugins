'use client'

import { SearchIcon } from '@payloadcms/ui'
import { useMemo, useState } from 'react'

import type { WikiTargetEntry } from '../../shared/targetKeys'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { BookIcon, StarIcon } from '../icons'
import { TargetChips } from '../TargetChips/TargetChips'
import './wiki-view.css'

export type WikiIndexClientProps = {
	/** Admin-prefixed wiki index URL guide links are built from. */
	baseUrl: string
	/** Published guides in presentation order (featured first). */
	entries: WikiTargetEntry[]
}

const matches = (entry: WikiTargetEntry, query: string): boolean =>
	(entry.title ?? '').toLowerCase().includes(query) ||
	(entry.summary ?? '').toLowerCase().includes(query) ||
	(entry.targetKeys ?? []).some((key) => key.toLowerCase().includes(query))

/**
 * The interactive half of the wiki index: a search box filtering the flat guide
 * list, with featured guides surfaced as cards while no search is active. Data
 * arrives fully resolved from the server view.
 *
 * The search bar reproduces the shape of the list view's own (a rounded
 * elevation surface with the glyph inside it) so the wiki reads as another
 * Payload listing rather than a page with a loose input on it.
 */
export const WikiIndexClient = ({ baseUrl, entries }: WikiIndexClientProps) => {
	const { t } = useTranslation()
	const [query, setQuery] = useState('')
	const trimmed = query.trim().toLowerCase()
	const linkable = useMemo(() => entries.filter((entry) => entry.slug), [entries])
	const filtered = trimmed ? linkable.filter((entry) => matches(entry, trimmed)) : null
	const featured = linkable.filter((entry) => entry.featured)
	const listed = filtered ?? linkable

	const renderRow = (entry: WikiTargetEntry) => (
		<li className="wiki-index__row" key={entry.id}>
			<a className="wiki-index__row-link" href={`${baseUrl}/${entry.slug}`}>
				<span className="wiki-index__row-main">
					<span className="wiki-index__row-title">
						{entry.featured ? <StarIcon size="small" /> : null}
						{entry.title}
					</span>
					{entry.summary ? <span className="wiki-index__row-summary">{entry.summary}</span> : null}
				</span>
				<TargetChips className="wiki-index__row-chips" targetKeys={entry.targetKeys} />
			</a>
		</li>
	)

	if (linkable.length === 0) {
		return (
			<div className="wiki-index">
				<div className="wiki-index__empty">
					<BookIcon className="wiki-index__empty-icon" />
					<p className="wiki-index__empty-title">{t(keys.wikiEmpty)}</p>
					<p className="wiki-index__empty-hint">{t(keys.wikiEmptyHint)}</p>
				</div>
			</div>
		)
	}

	return (
		<div className="wiki-index">
			<div className="wiki-index__search">
				<SearchIcon />
				<input
					aria-label={t(keys.wikiSearchPlaceholder)}
					className="wiki-index__search-input"
					onChange={(event) => setQuery(event.target.value)}
					placeholder={t(keys.wikiSearchPlaceholder)}
					type="search"
					value={query}
				/>
			</div>
			{filtered === null && featured.length > 0 ? (
				<section className="wiki-index__section">
					<h2 className="wiki-index__heading">{t(keys.wikiFeaturedHeading)}</h2>
					<div className="wiki-index__cards">
						{featured.map((entry) => (
							<a className="wiki-index__card" href={`${baseUrl}/${entry.slug}`} key={entry.id}>
								<span className="wiki-index__card-title">
									<StarIcon size="small" />
									{entry.title}
								</span>
								{entry.summary ? (
									<span className="wiki-index__card-summary">{entry.summary}</span>
								) : null}
								<TargetChips
									className="wiki-index__card-chips"
									limit={3}
									targetKeys={entry.targetKeys}
								/>
							</a>
						))}
					</div>
				</section>
			) : null}
			<section className="wiki-index__section">
				<h2 className="wiki-index__heading">
					{filtered === null ? t(keys.wikiAllGuidesHeading) : t(keys.wikiSearchPlaceholder)}
					<span className="wiki-index__count">
						{listed.length === 1
							? t(keys.guideCountOne)
							: t(keys.guideCount, { count: listed.length })}
					</span>
				</h2>
				{listed.length === 0 ? (
					<div className="wiki-index__empty wiki-index__empty--inline">
						<p className="wiki-index__empty-title">{t(keys.wikiNoResults)}</p>
						<p className="wiki-index__empty-hint">{t(keys.wikiNoResultsHint)}</p>
					</div>
				) : (
					<ul className="wiki-index__list">{listed.map(renderRow)}</ul>
				)}
			</section>
		</div>
	)
}
