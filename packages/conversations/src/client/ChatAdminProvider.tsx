'use client'

import { useConfig } from '@payloadcms/ui'
import { type ReactNode, useState } from 'react'

import { ChatProvider } from '../react/provider'
import { pusherClientTransport } from '../react/pusher'
import { sseClientTransport } from '../react/sse'
import { type ConversationsClientTransport, pollingTransport } from '../react/transport'
import type { ClientTransportSpec } from '../types'
import { type ChatComponents, ChatComponentsProvider } from './components'
import './conversations.css'

const clientTransport = (spec: ClientTransportSpec | undefined): ConversationsClientTransport => {
	if (spec === 'sse') return sseClientTransport()
	if (typeof spec === 'object') return pusherClientTransport(spec.pusher)
	return pollingTransport()
}

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
	transport?: ClientTransportSpec
}) => {
	const { config } = useConfig()
	const [client] = useState(() => clientTransport(transport))
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
