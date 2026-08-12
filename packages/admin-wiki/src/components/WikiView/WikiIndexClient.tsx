'use client'

import {
	AnimateHeight,
	ChevronIcon,
	Pill,
	PillSelector,
	SearchFilter,
	SearchIcon,
	useConfig,
} from '@payloadcms/ui'
import { useCallback, useMemo, useState } from 'react'

import type { WikiTargetEntry } from '../../shared/targetKeys'
import { chipTargetKeys, describeTargets } from '../../shared/targetLabels'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { BookIcon, StarIcon } from '../icons'
import { TargetChips } from '../TargetChips/TargetChips'
import { useWikiTargets } from '../WikiProvider/WikiProvider'
import './wiki-view.css'

export type WikiIndexClientProps = {
	/** Admin-prefixed wiki index URL guide links are built from. */
	baseUrl: string
	/** Published guides in presentation order (featured first). */
	entries: WikiTargetEntry[]
}

/** Ties the toggle pill to the panel it opens, for assistive tech. */
const FILTERS_ID = 'wiki-index-filters'

const matches = (entry: WikiTargetEntry, query: string): boolean =>
	(entry.title ?? '').toLowerCase().includes(query) ||
	(entry.summary ?? '').toLowerCase().includes(query) ||
	(entry.targetKeys ?? []).some((key) => key.toLowerCase().includes(query))

/**
 * The interactive half of the wiki index: a search box and target filters over
 * the flat guide list, with featured guides surfaced as cards while neither is
 * active. Data arrives fully resolved from the server view.
 *
 * The controls reproduce `ListControls` structurally, not just visually: the
 * same `list-controls` wrapper, `SearchFilter` inside `search-bar`, a toggle
 * pill in `search-bar__actions`, and the panel behind `AnimateHeight`. Payload's
 * stylesheet then does the rest, including the rule that spaces a `pill-selector`
 * below the bar. A panel that is always open and labelled is the one thing a
 * Payload list never shows, which is why the earlier version read as foreign.
 *
 * Filtering is `PillSelector` rather than a where-builder because guides attach
 * to whole surfaces: picking among those surfaces is the entire query a reader
 * can express.
 */
export const WikiIndexClient = ({ baseUrl, entries }: WikiIndexClientProps) => {
	const { t } = useTranslation()
	const { config } = useConfig()
	const { blockLabels } = useWikiTargets()
	const [query, setQuery] = useState('')
	const [selectedTargets, setSelectedTargets] = useState<string[]>([])
	const [filtersOpen, setFiltersOpen] = useState(false)
	const trimmed = query.trim().toLowerCase()
	const linkable = useMemo(() => entries.filter((entry) => entry.slug), [entries])

	const onSearchChange = useCallback((search: string) => setQuery(search ?? ''), [])

	/** Every surface some guide covers, labelled and sorted for the pill row. */
	const targetOptions = useMemo(() => {
		const unique = new Set<string>()
		for (const entry of linkable) {
			for (const key of chipTargetKeys(entry.targetKeys)) {
				unique.add(key)
			}
		}
		return describeTargets([...unique], {
			blockLabels,
			collections: config.collections,
			globals: config.globals,
		})
			.map((target) => ({ key: `${target.kind}:${target.value}`, label: target.label }))
			.sort((a, b) => a.label.localeCompare(b.label))
	}, [blockLabels, config.collections, config.globals, linkable])

	const toggleTarget = useCallback(
		(key: string) =>
			setSelectedTargets((current) =>
				current.includes(key) ? current.filter((value) => value !== key) : [...current, key]
			),
		[]
	)

	const hasFilters = targetOptions.length > 1
	const isFiltering = trimmed.length > 0 || selectedTargets.length > 0
	const listed = isFiltering
		? linkable.filter(
				(entry) =>
					(trimmed.length === 0 || matches(entry, trimmed)) &&
					(selectedTargets.length === 0 ||
						chipTargetKeys(entry.targetKeys).some((key) => selectedTargets.includes(key)))
			)
		: linkable
	const featured = linkable.filter((entry) => entry.featured)

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
			<div className="list-controls wiki-index__controls">
				<div className="search-bar">
					<SearchIcon />
					<SearchFilter handleChange={onSearchChange} label={t(keys.wikiSearchPlaceholder)} />
					{hasFilters ? (
						<div className="search-bar__actions">
							<Pill
								aria-controls={FILTERS_ID}
								aria-expanded={filtersOpen}
								className="list-controls__toggle-where"
								icon={<ChevronIcon direction={filtersOpen ? 'up' : 'down'} />}
								onClick={() => setFiltersOpen((open) => !open)}
								pillStyle="light"
								size="small"
							>
								{t(keys.wikiFilterLabel)}
							</Pill>
						</div>
					) : null}
				</div>
				{hasFilters ? (
					<AnimateHeight height={filtersOpen ? 'auto' : 0} id={FILTERS_ID}>
						<PillSelector
							onClick={({ pill }) => toggleTarget(pill.key ?? pill.name)}
							pills={targetOptions.map((option) => ({
								key: option.key,
								name: option.label,
								selected: selectedTargets.includes(option.key),
							}))}
						/>
					</AnimateHeight>
				) : null}
			</div>
			{!isFiltering && featured.length > 0 ? (
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
					{isFiltering ? t(keys.wikiResultsHeading) : t(keys.wikiAllGuidesHeading)}
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
