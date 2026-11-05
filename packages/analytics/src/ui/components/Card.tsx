import type { ReactNode } from 'react'
import { classNames } from '../classNames'
import '../analytics.css'

/** @beta */
export interface CardProps {
	/** `section` for a titled region of a page, as the analytics view's panels are. */
	as?: 'div' | 'section'
	/** The surface's own hooks, beside the shared `analytics-card`. */
	className?: string
	children?: ReactNode
	'aria-busy'?: boolean
	'aria-label'?: string
	'aria-labelledby'?: string
}

/**
 * The card every surface draws its panels in, Payload's own card tokens through the
 * `--analytics-card-*` properties. Free of hooks, so server and client surfaces compose it alike.
 *
 * @beta
 */
export function Card({ as: Element = 'div', className, children, ...aria }: CardProps) {
	return (
		<Element className={classNames('analytics-card', className)} {...aria}>
			{children}
		</Element>
	)
}
