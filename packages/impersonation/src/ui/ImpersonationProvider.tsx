import type { ServerProps } from 'payload'
import { createLocalReq } from 'payload'
import type { ReactNode } from 'react'

import { resolveTargetFilters } from '../access/filterTargets'
import { IMPERSONATION_SID_PREFIX } from '../plugin/constants'
import { readHintCookie } from '../plugin/lookup'
import { getRegistry } from '../plugin/registry'
import { startableCollectionSlugs } from '../plugin/startable'
import {
	findOpenBySid,
	impersonationSide,
	isPastAbsoluteExpiry,
	relationOf,
} from '../session/resolve'
import { keys } from '../translations/keys'
import { fillTemplate, messageFor } from '../translations/lookup'
import { asAuthUser, boundSid } from '../types'
import { ImpersonationBar } from './ImpersonationBar'
import { ImpersonationClientConfig } from './ImpersonationConfig'

export type ImpersonationProviderProps = ServerProps & { children?: ReactNode }

export const ImpersonationProvider = async ({
	children,
	payload,
	user,
}: ImpersonationProviderProps) => {
	const options = getRegistry(payload.config)
	if (!options) {
		return children
	}

	const startable = startableCollectionSlugs(payload.config.collections, options)
	let targets: Awaited<ReturnType<typeof resolveTargetFilters>> = Object.fromEntries(
		startable.map((slug) => [slug, true as const])
	)
	if (user && options.access.filterTargets) {
		const req = await createLocalReq({ user }, payload)
		targets = await resolveTargetFilters({ collections: startable, options, req })
	}

	const apiPath = `${payload.config.routes.api}${options.apiPath}`
	const sid = boundSid(user, options.session.binding)
	const painted = user ? asAuthUser(user)._impersonation : undefined
	const paintedLive = painted && !isPastAbsoluteExpiry(painted) ? painted : undefined
	const hint = await readHintCookie(options.hintCookieName)
	const shouldLookup =
		!painted &&
		(Boolean(options.session.issue) ||
			Boolean(hint) ||
			Boolean(sid?.startsWith(IMPERSONATION_SID_PREFIX)))

	let row = null
	if (!painted && user && sid && shouldLookup) {
		row = await findOpenBySid({ options, payload, sid })
		if (row && isPastAbsoluteExpiry(row)) {
			row = null
		}
	}

	const status = paintedLive
		? {
				absoluteExpiresAt: paintedLive.absoluteExpiresAt ?? null,
				active: true as const,
				impersonator: paintedLive.impersonator,
				impersonatorLocale: paintedLive.impersonatorLocale ?? null,
				mode: paintedLive.mode,
				side: 'target' as const,
				startedAt: paintedLive.startedAt,
				target: paintedLive.target,
			}
		: row && sid
			? {
					absoluteExpiresAt: row.absoluteExpiresAt ?? null,
					active: true as const,
					impersonator: relationOf(row.impersonator),
					impersonatorLocale: row.impersonatorLocale ?? null,
					mode: row.mode,
					side: impersonationSide(row, sid),
					startedAt: row.startedAt,
					target: relationOf(row.target),
				}
			: { active: false as const }

	const barSource = paintedLive
		? {
				absoluteExpiresAt: paintedLive.absoluteExpiresAt,
				impersonatorEmail: paintedLive.impersonatorEmail,
				impersonatorId: paintedLive.impersonator.id,
				impersonatorLocale: paintedLive.impersonatorLocale,
				mode: paintedLive.mode,
				side: 'target' as const,
				targetEmail: paintedLive.targetEmail,
				targetId: paintedLive.target.id,
			}
		: row && sid
			? {
					absoluteExpiresAt: row.absoluteExpiresAt,
					impersonatorEmail: row.impersonatorEmail,
					impersonatorId: relationOf(row.impersonator)?.id,
					impersonatorLocale: row.impersonatorLocale,
					mode: row.mode,
					side: impersonationSide(row, sid),
					targetEmail: row.targetEmail,
					targetId: relationOf(row.target)?.id,
				}
			: null

	const wrapped = (
		<ImpersonationClientConfig
			value={{
				apiPath,
				cardEmail: options.ui.cardEmail,
				reasonMode: options.reason,
				sessionCollection: options.collectionSlug,
				status,
				targets,
			}}
		>
			{children}
		</ImpersonationClientConfig>
	)

	if (!options.ui.bar || !barSource) {
		return wrapped
	}

	const locale = barSource.impersonatorLocale
	const targetName = barSource.targetEmail ?? String(barSource.targetId ?? '')
	const impersonatorLabel = barSource.impersonatorEmail ?? barSource.impersonatorId ?? ''
	const isImpersonatorSide = barSource.side === 'impersonator' && barSource.mode === 'parallel'
	const actingAs = isImpersonatorSide
		? fillTemplate(messageFor(locale, keys.sessionActiveOnSite), '{{name}}', String(targetName))
		: fillTemplate(messageFor(locale, keys.actingAs), '{{name}}', String(targetName))
	const returnTo = isImpersonatorSide
		? messageFor(locale, keys.endSession)
		: fillTemplate(messageFor(locale, keys.returnTo), '{{name}}', String(impersonatorLabel))

	return (
		<>
			{wrapped}
			<ImpersonationBar
				actingAs={actingAs}
				adminRoute={payload.config.routes.admin}
				apiPath={apiPath}
				frontendUrl={payload.config.serverURL || undefined}
				impersonatorLocale={locale}
				openWebsite={messageFor(locale, keys.openWebsite)}
				pluginName={messageFor(locale, keys.pluginName)}
				returnTo={returnTo}
				sessionEndsAt={barSource.absoluteExpiresAt}
				sessionEndsAtTemplate={messageFor(locale, keys.sessionEndsAt)}
				sessionEndsInTemplate={messageFor(locale, keys.sessionEndsIn)}
				showFrontendLink={isImpersonatorSide}
			/>
		</>
	)
}
