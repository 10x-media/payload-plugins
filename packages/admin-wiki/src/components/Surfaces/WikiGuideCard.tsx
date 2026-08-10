'use client'

import type { WikiTargetEntry } from '../../shared/targetKeys'
import { StarIcon } from '../icons'
import './surfaces.css'

export type WikiGuideCardProps = {
	/** The narrow variant: tighter, one per row, no featured star. */
	compact?: boolean
	entry: WikiTargetEntry
	/** Navigate on click. Mutually exclusive with `onClick`. */
	href?: string
	/** Open a drawer on click. Mutually exclusive with `href`. */
	onClick?: () => void
}

/**
 * One guide as a card, shared by the list band and the document sidebar so a
 * guide looks the same wherever a reader meets it.
 *
 * The two surfaces differ in what a card does, not in what it is: on a list it
 * navigates to the reading view, in the sidebar it opens the drawer without
 * leaving the document being edited. Hence the element switch rather than two
 * components.
 *
 * The compact variant drops the star: in the sidebar every card is already about
 * the document you are on, so "featured" ranks nothing the reader can see.
 */
export const WikiGuideCard = ({ compact = false, entry, href, onClick }: WikiGuideCardProps) => {
	const className = ['wiki-guide-card', compact ? 'wiki-guide-card--compact' : null]
		.filter(Boolean)
		.join(' ')
	const content = (
		<>
			<span className="wiki-guide-card__title">
				{!compact && entry.featured ? <StarIcon size="small" /> : null}
				{entry.title}
			</span>
			{entry.summary ? <span className="wiki-guide-card__summary">{entry.summary}</span> : null}
		</>
	)

	if (href) {
		return (
			<a className={className} href={href}>
				{content}
			</a>
		)
	}

	return (
		<button className={className} onClick={onClick} type="button">
			{content}
		</button>
	)
}
