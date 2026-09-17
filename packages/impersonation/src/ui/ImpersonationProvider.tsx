import type { ServerProps } from 'payload'
import type { ReactNode } from 'react'

import { getRegistry } from '../plugin/registry'
import { findOpenBySid, isPastAbsoluteExpiry, relationOf } from '../session/resolve'
import { keys } from '../translations/keys'
import { messageFor } from '../translations/lookup'
import { boundSid } from '../types'
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

	const wrapped = (
		<ImpersonationClientConfig
			value={{
				apiPath: `${payload.config.routes.api}${options.apiPath}`,
				reasonMode: options.reason,
			}}
		>
			{children}
		</ImpersonationClientConfig>
	)

	if (!options.ui.bar || !user) {
		return wrapped
	}

	const sid = boundSid(user, options.session.binding)
	if (!sid) {
		return wrapped
	}

	const row = await findOpenBySid({ options, payload, sid })

	if (!row || isPastAbsoluteExpiry(row)) {
		return wrapped
	}

	const impersonator = relationOf(row.impersonator)
	const targetName = row.targetEmail ?? String(relationOf(row.target)?.id ?? '')
	const impersonatorLabel = row.impersonatorEmail ?? impersonator?.id ?? ''
	const locale = row.impersonatorLocale

	return (
		<>
			{wrapped}
			<ImpersonationBar
				actingAs={messageFor(locale, keys.actingAs).replace('{{name}}', String(targetName))}
				adminRoute={payload.config.routes.admin}
				apiPath={`${payload.config.routes.api}${options.apiPath}`}
				impersonatorLocale={locale}
				pluginName={messageFor(locale, keys.pluginName)}
				returnTo={messageFor(locale, keys.returnTo).replace('{{name}}', String(impersonatorLabel))}
				sessionEndsAt={row.absoluteExpiresAt}
				sessionEndsAtTemplate={messageFor(locale, keys.sessionEndsAt)}
			/>
		</>
	)
}
