import type { SettingsOverlayEmbedServer } from '@10x-media/settings-overlay/types'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import type { AdminViewServerProps } from 'payload'
import type React from 'react'

type Props = {
	/** Present only when this view is being rendered inside a settings panel. */
	settingsOverlayEmbed?: SettingsOverlayEmbedServer
} & AdminViewServerProps

/**
 * A registered admin view with a route of its own (`/admin/dev-report`), also listed in an
 * overlay as a `view` item.
 *
 * This is the "your own view" case from the docs: it reads `settingsOverlayEmbed` and skips
 * `DefaultTemplate` when it finds itself inside the panel, so no bundler alias is needed. A view
 * you do not own cannot be asked to do this, which is what `@10x-media/settings-overlay/embed`
 * is for.
 */
export const DevReportView: React.FC<Props> = ({
	initPageResult,
	params,
	searchParams,
	settingsOverlayEmbed,
}) => {
	const body = (
		<div style={{ display: 'grid', gap: 12 }}>
			<h2 style={{ margin: 0 }}>Dev report</h2>
			<p style={{ color: 'var(--theme-elevation-600)', margin: 0 }}>
				{settingsOverlayEmbed
					? `Rendering inside the "${settingsOverlayEmbed.overlayId}" panel, so the admin chrome is left out.`
					: 'Rendering as a page, with the usual sidebar and header.'}
			</p>
			<pre
				style={{
					background: 'var(--theme-elevation-50)',
					borderRadius: 4,
					margin: 0,
					overflowX: 'auto',
					padding: 12,
				}}
			>
				{JSON.stringify({ searchParams, user: initPageResult?.req?.user?.email }, null, 2)}
			</pre>
		</div>
	)

	if (settingsOverlayEmbed) {
		return <div style={{ padding: 20 }}>{body}</div>
	}

	return (
		<DefaultTemplate
			i18n={initPageResult.req.i18n}
			locale={initPageResult.locale}
			params={params}
			payload={initPageResult.req.payload}
			permissions={initPageResult.permissions}
			searchParams={searchParams}
			user={initPageResult.req.user ?? undefined}
			visibleEntities={initPageResult.visibleEntities}
		>
			<Gutter>{body}</Gutter>
		</DefaultTemplate>
	)
}
