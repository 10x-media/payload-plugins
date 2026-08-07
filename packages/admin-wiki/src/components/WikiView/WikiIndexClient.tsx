'use client'

import { useMemo, useState } from 'react'

import type { WikiTargetEntry } from '../../shared/targetKeys'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import './wiki-view.css'

export type WikiIndexClientProps = {
	/** Admin-prefixed wiki index URL guide links are built from. */
	baseUrl: string
	/** Published guides in presentation order (featured first). */
	entries: WikiTargetEntry[]
}

const matches = (entry: WikiTargetEntry, query: string): boolean =>
	(entry.title ?? '').toLowerCase().includes(query) ||
	(entry.summary ?? '').toLowerCase().includes(query)

/**
 * The interactive half of the wiki index: a search box filtering the flat
 * guide list, with featured guides surfaced as cards while no search is
 * active. Data arrives fully resolved from the server view.
 */
export const WikiIndexClient = ({ baseUrl, entries }: WikiIndexClientProps) => {
	const { t } = useTranslation()
	const [query, setQuery] = useState('')
	const trimmed = query.trim().toLowerCase()
	const linkable = useMemo(() => entries.filter((entry) => entry.slug), [entries])
	const filtered = trimmed ? linkable.filter((entry) => matches(entry, trimmed)) : null
	const featured = linkable.filter((entry) => entry.featured)

	const renderRow = (entry: WikiTargetEntry) => (
		<li className="wiki-index__row" key={entry.id}>
			<a className="wiki-index__row-link" href={`${baseUrl}/${entry.slug}`}>
				<span className="wiki-index__row-title">{entry.title}</span>
				{entry.summary ? <span className="wiki-index__row-summary">{entry.summary}</span> : null}
			</a>
		</li>
	)

	return (
		<div className="wiki-index">
			<input
				aria-label={t(keys.wikiSearchPlaceholder)}
				className="wiki-index__search"
				onChange={(event) => setQuery(event.target.value)}
				placeholder={t(keys.wikiSearchPlaceholder)}
				type="search"
				value={query}
			/>
			{linkable.length === 0 ? (
				<p className="wiki-index__status">{t(keys.wikiEmpty)}</p>
			) : filtered ? (
				filtered.length === 0 ? (
					<p className="wiki-index__status">{t(keys.wikiNoResults)}</p>
				) : (
					<ul className="wiki-index__list">{filtered.map(renderRow)}</ul>
				)
			) : (
				<>
					{featured.length > 0 ? (
						<section className="wiki-index__featured">
							<h2 className="wiki-index__heading">{t(keys.wikiFeaturedHeading)}</h2>
							<div className="wiki-index__cards">
								{featured.map((entry) => (
									<a className="wiki-index__card" href={`${baseUrl}/${entry.slug}`} key={entry.id}>
										<span className="wiki-index__card-title">{entry.title}</span>
										{entry.summary ? (
											<span className="wiki-index__card-summary">{entry.summary}</span>
										) : null}
									</a>
								))}
							</div>
						</section>
					) : null}
					<section>
						<h2 className="wiki-index__heading">{t(keys.wikiAllGuidesHeading)}</h2>
						<ul className="wiki-index__list">{linkable.map(renderRow)}</ul>
					</section>
				</>
			)}
		</div>
	)
}
