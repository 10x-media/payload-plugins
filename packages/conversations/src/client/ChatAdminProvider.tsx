'use client'

import { useConfig } from '@payloadcms/ui'
import { type ReactNode, useState } from 'react'

import { ChatProvider } from '../react/provider'
import { sseClientTransport } from '../react/sse'
import { pollingTransport } from '../react/transport'
import { type ChatComponents, ChatComponentsProvider } from './components'
import './conversations.css'

/**
 * The admin's provider for one instance. The plugin registers the server half
 * (`ChatAdminProviderServer`), which resolves config-level components and
 * renders this. Reads the API route from the Payload config.
 */
export const ChatAdminProvider = ({
	children,
	components,
	instance,
	transport,
}: {
	children?: ReactNode
	/** Config-level components, resolved by `ChatAdminProviderServer`. */
	components?: ChatComponents
	instance: string
	/** The client half of the instance's server transport. */
	transport?: 'polling' | 'sse'
}) => {
	const { config } = useConfig()
	const [client] = useState(() => (transport === 'sse' ? sseClientTransport() : pollingTransport()))
	return (
		<ChatProvider
			apiRoute={config.routes.api}
			instance={instance}
			serverURL={config.serverURL}
			transport={client}
		>
			<ChatComponentsProvider components={components} instance={instance}>
				{children}
			</ChatComponentsProvider>
		</ChatProvider>
	)
}
