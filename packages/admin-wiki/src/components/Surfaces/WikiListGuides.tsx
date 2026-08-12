'use client'

import { Gutter, useConfig, useDrawerSlug, useModal } from '@payloadcms/ui'
import type { ReactNode } from 'react'

import type { WikiListBandSlot } from '../../options'
import type { WikiTargetEntry } from '../../shared/targetKeys'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { WikiWriteGuide } from '../FieldHelp/WikiWriteGuide'
import { GuideDrawer } from '../GuideDrawer/GuideDrawer'
import { useWikiTargets } from '../WikiProvider/WikiProvider'
import { WikiAllGuidesButton } from './WikiAllGuidesButton'
import { WikiGuideCard } from './WikiGuideCard'
import './surfaces.css'

/**
 * Payload renders `beforeList` and `afterList` outside the list's own `Gutter`
 * and the two table slots inside it, so the band has to supply the horizontal
 * padding in exactly the two cases where nothing else does.
 */
const OUTSIDE_LIST_GUTTER: ReadonlySet<WikiListBandSlot> = new Set<WikiListBandSlot>([
	'afterList',
	'beforeList',
])

export type WikiListGuidesProps = {
	/** Lead with the collection's featured guides as cards. */
	featured: boolean
	/** The list slot this instance was registered in, which decides the gutter. */
	slot: WikiListBandSlot
	/** The collection being listed, as a wiki target key. */
	targetKey: string
}

/**
 * The guides band on a collection list: the featured guides for this collection
 * as cards, then everything else behind one drawer.
 *
 * This is the list view's only guide affordance. A card and a separate trigger
 * button are two representations of one fact, and a reader cannot tell by
 * looking which of them is the complete answer, so the cards are the trigger and
 * the overflow row is the rest of it.
 *
 * Reads the targets map the provider already holds rather than fetching: the map
 * is keyed by target and pre-sorted featured-first.
 */
export const WikiListGuides = ({ featured, slot, targetKey }: WikiListGuidesProps) => {
	const { t } = useTranslation()
	const { config } = useConfig()
	const { entriesFor, pagesSlug, wikiViewEnabled } = useWikiTargets()
	const { openModal } = useModal()
	const drawerSlug = useDrawerSlug('wiki-list-guides')
	const entries = entriesFor(targetKey)
	const cards = featured ? entries.filter((entry) => entry.featured) : []

	const hrefFor = (entry: WikiTargetEntry) =>
		wikiViewEnabled && entry.slug
			? `${config.routes.admin}/wiki/${entry.slug}`
			: `${config.routes.admin}/collections/${pagesSlug}/${entry.id}`

	const band: ReactNode =
		entries.length === 0 ? (
			<WikiWriteGuide targetKey={targetKey} variant="button" />
		) : (
			<div className={`wiki-list-guides wiki-list-guides--${slot}`}>
				<h2 className="wiki-list-guides__heading">{t(keys.surfaceTriggerLabel)}</h2>
				{cards.length > 0 ? (
					<div className="wiki-list-guides__cards">
						{cards.map((entry) => (
							<WikiGuideCard entry={entry} href={hrefFor(entry)} key={entry.id} />
						))}
					</div>
				) : null}
				{entries.length > cards.length ? (
					<WikiAllGuidesButton count={entries.length} onClick={() => openModal(drawerSlug)} />
				) : null}
				<GuideDrawer entries={entries} slug={drawerSlug} />
			</div>
		)

	return OUTSIDE_LIST_GUTTER.has(slot) ? <Gutter>{band}</Gutter> : band
}
