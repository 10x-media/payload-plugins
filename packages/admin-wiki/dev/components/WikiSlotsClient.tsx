'use client'

import type { WikiViewSlotClientProps } from '../../src/options'

/** Client component in the `beforeControls` slot, beside the header actions. */
export const DevWikiHeaderLink = ({ wikiPath }: WikiViewSlotClientProps) => (
	<a href={`${wikiPath}?dev=1`} style={{ fontSize: '0.8125rem' }}>
		Dev link
	</a>
)

/** Client component in the `afterTable` slot, below the guide list. */
export const DevWikiFooter = ({ guideCount }: WikiViewSlotClientProps) => (
	<p style={{ color: 'var(--theme-elevation-500)', fontSize: '0.8125rem', margin: 0 }}>
		Dev footer slot, {guideCount} guides listed.
	</p>
)
