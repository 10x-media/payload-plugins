'use client'

import { useConfig } from '@payloadcms/ui'
import type { ReactNode } from 'react'

import { ChatProvider } from '../react/provider'
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
}: {
	children?: ReactNode
	/** Config-level components, resolved by `ChatAdminProviderServer`. */
	components?: ChatComponents
	instance: string
}) => {
	const { config } = useConfig()
	return (
		<ChatProvider apiRoute={config.routes.api} instance={instance} serverURL={config.serverURL}>
			<ChatComponentsProvider components={components} instance={instance}>
				{children}
			</ChatComponentsProvider>
		</ChatProvider>
	)
}
