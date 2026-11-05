import { ShimmerEffect } from '@payloadcms/ui'

/** Shown while a display field's read runs: Payload's shimmer, about as tall as the field. */
export function FieldShimmer({ height }: { height: string }) {
	return (
		<div aria-busy="true" className="field-type analytics-field--loading">
			<ShimmerEffect height={height} />
		</div>
	)
}
