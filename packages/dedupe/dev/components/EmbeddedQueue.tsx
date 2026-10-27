import { DedupeQueue } from '@10x-media/dedupe/rsc'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import type { AdminViewServerProps } from 'payload'

/**
 * Dev stand only: a page of the host's own with the queue in it, as `view.queue: false` expects.
 * The stand keeps the plugin's page at `/dedupe` for the e2e suite, so this one sits beside it.
 */
export const EmbeddedQueue = ({ initPageResult, params, searchParams }: AdminViewServerProps) => {
	const { req } = initPageResult
	return (
		<DefaultTemplate
			i18n={req.i18n}
			locale={initPageResult.locale}
			params={params}
			payload={req.payload}
			permissions={initPageResult.permissions}
			req={req}
			searchParams={searchParams}
			user={req.user ?? undefined}
			visibleEntities={initPageResult.visibleEntities}
		>
			<Gutter>
				<p className="embedded-queue__note">The host's page, with the plugin's queue below.</p>
				<DedupeQueue req={req} searchParams={searchParams} />
			</Gutter>
		</DefaultTemplate>
	)
}
