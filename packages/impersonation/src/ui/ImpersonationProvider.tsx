import type { ServerProps } from 'payload'
import type { ReactNode } from 'react'

import { getRegistry } from '../plugin/registry'
import { isPastAbsoluteExpiry, relationOf, resolveCurrent } from '../session/resolve'
import { boundSid } from '../types'
import { ImpersonationBar } from './ImpersonationBar'

export type ImpersonationProviderProps = ServerProps & { children?: ReactNode }

export const ImpersonationProvider = async ({
	children,
	payload,
	user,
}: ImpersonationProviderProps) => {
	const options = getRegistry(payload.config)
	if (!options?.ui.bar || !user) {
		return children
	}

	const sid = boundSid(user, options.session.binding)
	if (!sid) {
		return children
	}

	const row = await resolveCurrent({
		headers: new Headers(),
		options,
		payload,
		sid,
	})

	if (!row || isPastAbsoluteExpiry(row)) {
		return children
	}

	const impersonator = relationOf(row.impersonator)
	const targetName = row.targetEmail ?? String(relationOf(row.target)?.id ?? '')
	const impersonatorLabel = row.impersonatorEmail ?? impersonator?.id ?? ''

	return (
		<>
			{children}
			<ImpersonationBar
				apiPath={`${payload.config.routes.api}${options.apiPath}`}
				impersonatorLabel={String(impersonatorLabel)}
				impersonatorLocale={row.impersonatorLocale}
				name={targetName}
				sessionEndsAt={row.absoluteExpiresAt}
			/>
		</>
	)
}
