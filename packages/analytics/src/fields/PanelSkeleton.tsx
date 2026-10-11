'use client'

import { ShimmerEffect } from '@payloadcms/ui'

/** Rows each list draws, the read's own default. */
const PANEL_LIST_ROWS = 5

const slots = (count: number): number[] => Array.from({ length: count }, (_, slot) => slot)

const skeletonPart = (part: 'label' | 'value' | 'delta') => (
	<ShimmerEffect
		className={`analytics-view__skeleton analytics-view__skeleton--${part}`}
		disableInlineStyles
	/>
)

/**
 * The panel's shape while its first read runs: as many cards, the chart's height and the lists
 * at their row pitch, so the answer moves nothing when it lands.
 */
export function PanelSkeleton({ cards, lists }: { cards: number; lists: number }) {
	return (
		<div aria-hidden="true" className="analytics-panel__content">
			<div className="analytics-panel__cards">
				{slots(cards).map((slot) => (
					<div
						className="analytics-metric analytics-panel__card analytics-panel__card--skeleton"
						key={slot}
					>
						{skeletonPart('label')}
						{skeletonPart('value')}
						{skeletonPart('delta')}
					</div>
				))}
			</div>
			<ShimmerEffect
				className="analytics-view__skeleton analytics-view__skeleton--chart analytics-panel__skeleton-chart"
				disableInlineStyles
			/>
			{lists > 0 ? (
				<div className="analytics-panel__lists">
					{slots(lists).map((slot) => (
						<div className="analytics-panel__list" key={slot}>
							{skeletonPart('label')}
							<div className="analytics-panel__skeleton-rows">
								{slots(PANEL_LIST_ROWS).map((row) => (
									<ShimmerEffect
										className="analytics-view__skeleton"
										disableInlineStyles
										key={row}
									/>
								))}
							</div>
						</div>
					))}
				</div>
			) : null}
			<ShimmerEffect
				className="analytics-view__skeleton analytics-panel__skeleton-caption"
				disableInlineStyles
			/>
			<ShimmerEffect
				className="analytics-view__skeleton analytics-panel__skeleton-notice"
				disableInlineStyles
			/>
		</div>
	)
}
