'use client'

const bar = 'settings-overlay__shimmer'

const Bars = ({ count, className }: { className: string; count: number }) => (
	<div className={className}>
		{Array.from({ length: count }, (_, index) => (
			// Placeholder bars have no identity beyond their position.
			// biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
			<span className={bar} key={index} />
		))}
	</div>
)

export const RailSkeleton = () => <Bars className="settings-overlay__skeleton-rail" count={6} />

export const ListSkeleton = () => <Bars className="settings-overlay__skeleton-list" count={8} />

export const DocumentSkeleton = () => (
	<Bars className="settings-overlay__skeleton-document" count={5} />
)

export const ItemSkeleton = () => <Bars className="settings-overlay__skeleton-item" count={4} />
