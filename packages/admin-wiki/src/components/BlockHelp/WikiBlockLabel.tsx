import { WikiBlockLabelClient } from './WikiBlockLabelClient'

export type WikiBlockLabelProps = {
	/** Injected client prop: the block's slug, keying `block:` guide targets. */
	blockSlug: string
	/** Default row label Payload computes server-side ("Block Name 01"). */
	rowLabel?: string
}

/**
 * Server half of the injected block row label: Payload provides the default
 * `rowLabel` string only to server components, so this wrapper captures it and
 * hands both it and the block slug to the client label.
 */
export const WikiBlockLabel = ({ blockSlug, rowLabel }: WikiBlockLabelProps) => (
	<WikiBlockLabelClient blockSlug={blockSlug} rowLabel={rowLabel ?? null} />
)
