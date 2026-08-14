import type { WikiViewSlotClientProps, WikiViewSlotServerProps } from '../../src/options'

/**
 * Server component in the wiki index `beforeTable` slot. Exercises the server
 * props by counting drafts, which the index itself never shows.
 */
export const DevWikiNotice = async ({
	guideCount,
	locale,
	payload,
	req,
}: WikiViewSlotClientProps & WikiViewSlotServerProps) => {
	const drafts = await payload.count({
		collection: 'wiki-pages',
		overrideAccess: false,
		req,
		user: req.user,
		where: { _status: { not_equals: 'published' } },
	})
	return (
		<aside
			style={{
				background: 'var(--theme-elevation-50)',
				borderRadius: '4px',
				fontSize: '0.8125rem',
				padding: '0.75rem 1rem',
			}}
		>
			{guideCount} published, {drafts.totalDocs} in draft
			{locale ? `, reading in ${locale}` : null}
		</aside>
	)
}
