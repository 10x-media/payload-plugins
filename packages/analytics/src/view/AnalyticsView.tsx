import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter, HydrateAuthProvider, SetStepNav } from '@payloadcms/ui'
import { notFound, redirect } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'
import { runtimeFactoryOf } from '../plugin/runtime'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'
import { WithScopeToken } from '../ui/data/WithScopeToken'
import { loginRedirectUrl } from './authRedirect'
import { DocumentTitle } from './DocumentTitle'
import { resolveNavLabel } from './navLabel'
import { renderViewBody } from './viewBody'
import { resolveViewProps } from './viewProps'

/** @internal */
export type AnalyticsViewProps = AdminViewServerProps

/**
 * The analytics dashboard's server shell: it resolves sources, goals and timezone once for the
 * client body, and shows a reader `access.view` denies the admin chrome with a message.
 *
 * @internal
 */
export async function AnalyticsView({
	initPageResult,
	params,
	searchParams,
	user: viewUser,
	viewActions,
}: AnalyticsViewProps) {
	const { req } = initPageResult
	const t = asTranslate(req.i18n.t)

	if (!req.user) {
		redirect(loginRedirectUrl({ config: req.payload.config, params, searchParams }))
	}

	const resolved = runtimeFactoryOf(req.payload.config)?.resolved
	if (!resolved) {
		notFound()
	}
	const result = await resolveViewProps(req, resolved, searchParams)
	const navLabel = resolveNavLabel({
		...(resolved.view !== false && resolved.view.navLabel !== undefined
			? { label: resolved.view.navLabel }
			: {}),
		language: req.i18n.language,
		fallbackLanguage: req.i18n.fallbackLanguage,
		fallback: t(keys.viewNavLabel),
	})
	// A shallow copy: the template hands this straight to a provider, and the object on
	// `initPageResult` is shared with everything else the request renders.
	const visibleEntities = {
		collections: initPageResult.visibleEntities.collections,
		globals: initPageResult.visibleEntities.globals,
	}
	// Worded as Payload words every admin tab: the title, then the configured suffix.
	const suffix = req.payload.config.admin.meta?.titleSuffix
	const tabTitle = suffix ? `${t(keys.viewTitle)} ${suffix}` : t(keys.viewTitle)

	return (
		<DefaultTemplate
			i18n={req.i18n}
			locale={initPageResult.locale}
			params={params}
			payload={req.payload}
			permissions={initPageResult.permissions}
			searchParams={searchParams}
			// Payload hands views a user read through its field access, safe for client components.
			user={viewUser ?? req.user}
			visibleEntities={visibleEntities}
			{...(viewActions ? { viewActions } : {})}
			req={req}
		>
			<HydrateAuthProvider permissions={initPageResult.permissions} />
			<SetStepNav nav={[{ label: navLabel }]} />
			<DocumentTitle title={tabTitle} />
			<Gutter>
				{result.denied ? (
					<p>{t(keys.viewNoAccess)}</p>
				) : (
					<WithScopeToken req={req}>
						{renderViewBody({
							resolved,
							props: result.props,
							importMap: req.payload.importMap,
							warn: (message) => req.payload.logger.warn(message),
						})}
					</WithScopeToken>
				)}
			</Gutter>
		</DefaultTemplate>
	)
}
