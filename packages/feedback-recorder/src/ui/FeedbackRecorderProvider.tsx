import type { ServerProps } from 'payload'
import type { ReactNode } from 'react'

import { getRegistry } from '../plugin/registry'
import type { ClientConfig } from '../types'
import { RecorderProvider } from './RecorderProvider'

export type FeedbackRecorderProviderProps = ServerProps & { children?: ReactNode }

/**
 * Decides on the server whether this user gets the recorder at all: the site must have a 10x
 * connection and the `access` option must allow the user. Otherwise the admin renders exactly as
 * without the plugin, and the header button finds no recorder and renders nothing.
 */
export const FeedbackRecorderProvider = async ({
	children,
	payload,
	user,
}: FeedbackRecorderProviderProps) => {
	const options = getRegistry(payload.config)
	if (!options?.configured || !user) return children

	const allowed = await Promise.resolve(options.access({ payload, user })).catch(() => false)
	if (!allowed) return children

	const config: ClientConfig = {
		endpoint: `${payload.config.routes.api}${options.apiPath}`,
		adminRoute: payload.config.routes.admin,
		captureConsole: options.captureConsole,
	}
	return <RecorderProvider config={config}>{children}</RecorderProvider>
}
