import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'
import { type AnalyticsPluginOptions, resolveOptions } from '../core/options'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'
import { AnalyticsViewClient } from './AnalyticsViewClient'
import { loginRedirectUrl } from './authRedirect'
import { resolveViewProps } from './viewProps'

export type AnalyticsViewProps = AdminViewServerProps & {
	pluginOptions: AnalyticsPluginOptions
}

/**
 * The analytics dashboard's server shell. It resolves the request's sources, goals and
 * timezone once, then hands them to the client body, which reads everything else through
 * the public query endpoint. A reader `access.view` denies gets the admin chrome with a
 * message rather than a redirect: they are signed in, and bouncing them to a login form
 * they already passed would loop.
 */
export async function AnalyticsView({
	initPageResult,
	params,
	searchParams,
	pluginOptions,
}: AnalyticsViewProps) {
	const { req } = initPageResult
	const { user } = req
	const t = asTranslate(req.i18n.t)

	if (!user) {
		redirect(loginRedirectUrl({ config: req.payload.config, params, searchParams }))
	}

	const resolved = resolveOptions(pluginOptions)
	const result = await resolveViewProps(req, resolved)

	return (
		<DefaultTemplate
			i18n={req.i18n}
			locale={initPageResult.locale}
			params={params}
			payload={req.payload}
			permissions={initPageResult.permissions}
			searchParams={searchParams}
			user={user}
			visibleEntities={initPageResult.visibleEntities}
			req={req}
		>
			<Gutter>
				{result.denied ? <p>{t(keys.viewNoAccess)}</p> : <AnalyticsViewClient {...result.props} />}
			</Gutter>
		</DefaultTemplate>
	)
}
