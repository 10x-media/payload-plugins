import { ShimmerEffect } from '@payloadcms/ui'
import { type ReactNode, Suspense } from 'react'
import { Card } from '../ui/components/Card'
import { WidgetCard } from './WidgetCard'

/**
 * The shape a loading card stands in for, so it stands as tall as the finished card.
 *
 * @beta
 */
export type WidgetShimmerKind = 'metric' | 'trend' | 'realtime' | 'breakdown' | 'goals'

/** @beta */
export interface WidgetShimmerProps {
	/** The widget kind's own hook, the same one the finished card carries. */
	className?: string
	title: string
	/**
	 * The finished card may name itself otherwise (daily visitors, summed, from a source only the
	 * read resolves): the title shimmers too, and `title` is only read out to assistive tech.
	 */
	titlePending?: boolean
	/** Left out, a value over a body of no set height. */
	kind?: WidgetShimmerKind
	/** Rows a list kind stands in for: its row limit, which the read rarely falls short of. */
	rows?: number
	/** The footer link's text, held invisibly so the finished card's footer takes no new line. */
	link?: string
}

const loadingClass = (className: string | undefined): string =>
	className ? `${className} analytics-widget--loading` : 'analytics-widget--loading'

const HAS_VALUE: ReadonlySet<WidgetShimmerKind | undefined> = new Set([
	undefined,
	'metric',
	'trend',
	'realtime',
])

const HAS_BODY: ReadonlySet<WidgetShimmerKind | undefined> = new Set([
	undefined,
	'trend',
	'realtime',
	'breakdown',
	'goals',
])

const Loading = ({ kind, rows }: Pick<WidgetShimmerProps, 'kind' | 'rows'>) => (
	<div
		aria-busy="true"
		className={
			kind
				? `analytics-widget__loading analytics-widget__loading--${kind}`
				: 'analytics-widget__loading'
		}
		{...(rows === undefined ? {} : { style: { '--analytics-rows': String(rows) } })}
	>
		{HAS_VALUE.has(kind) ? (
			<ShimmerEffect className="analytics-widget__shimmer-value" disableInlineStyles />
		) : null}
		{HAS_BODY.has(kind) ? (
			<ShimmerEffect className="analytics-widget__shimmer" disableInlineStyles />
		) : null}
	</div>
)

const Footer = ({ link }: { link: string | undefined }) =>
	link === undefined ? null : (
		<div aria-hidden="true" className="analytics-widget__footer">
			<span className="analytics-widget__link analytics-widget__link--placeholder">{link}</span>
		</div>
	)

/**
 * The card a widget shows while its read runs: its own title over Payload's shimmer, shaped like
 * the finished card of its kind so the dashboard keeps its layout.
 *
 * @beta
 */
export function WidgetShimmer({
	className,
	title,
	titlePending,
	kind,
	rows,
	link,
}: WidgetShimmerProps) {
	const loading = (
		<>
			<Loading
				{...(kind === undefined ? {} : { kind })}
				{...(rows === undefined ? {} : { rows })}
			/>
			<Footer link={link} />
		</>
	)
	if (titlePending === true) {
		return (
			<Card className={`analytics-widget ${loadingClass(className)}`}>
				<div className="analytics-widget__header">
					<h2 className="analytics-widget__title analytics-sr-only">{title}</h2>
					<ShimmerEffect height="1rem" width="40%" />
				</div>
				{loading}
			</Card>
		)
	}
	return (
		<WidgetCard className={loadingClass(className)} title={title}>
			{loading}
		</WidgetCard>
	)
}

/**
 * A widget's body behind its own Suspense boundary. Payload's dashboard renders its widgets
 * without one, so a slow read would otherwise hold back every card on it.
 *
 * @beta
 */
export function WidgetSuspense({
	children,
	...shimmer
}: WidgetShimmerProps & { children: ReactNode }) {
	return <Suspense fallback={<WidgetShimmer {...shimmer} />}>{children}</Suspense>
}
