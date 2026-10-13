import type { ServerProps } from 'payload'
import type { ReactNode } from 'react'

import { getRegistry } from '../plugin/registry'
import type { ClientConfig } from '../types'
import { RecorderProvider } from './RecorderProvider'
import { userKey } from './userKey'

export type FeedbackRecorderProviderProps = ServerProps & { children?: ReactNode }

/**
 * Mounts the recorder for a site with a 10x connection. Whether the signed-in user may use it is
 * decided here for the first paint, and again in the browser after every sign-in: this provider
 * sits in the admin's root layout, which does not re-render when somebody signs in. Without a
 * connection the admin renders exactly as without the plugin.
 */
export const FeedbackRecorderProvider = async ({
	children,
	payload,
	user,
}: FeedbackRecorderProviderProps) => {
	const options = getRegistry(payload.config)
	if (!options?.configured) return children

	const allowed = user
		? await Promise.resolve(options.access({ payload, user })).catch(() => false)
		: false

	const config: ClientConfig = {
		endpoint: `${payload.config.routes.api}${options.apiPath}`,
		adminRoute: payload.config.routes.admin,
		captureConsole: options.captureConsole,
	}
	return (
		<RecorderProvider config={config} initiallyAllowed={allowed} initialUserKey={userKey(user)}>
			{children}
		</RecorderProvider>
	)
}
