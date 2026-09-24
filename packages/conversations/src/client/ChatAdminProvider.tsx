'use client'

import { useConfig } from '@payloadcms/ui'
import type { ReactNode } from 'react'

import { ChatProvider } from '../react/provider'
import './conversations.css'

/**
 * The admin's provider for one instance, registered in
 * `admin.components.providers` by the plugin. Reads the API route from the
 * Payload config.
 */
export const ChatAdminProvider = ({
	children,
	instance,
}: {
	children?: ReactNode
	instance: string
}) => {
	const { config } = useConfig()
	return (
		<ChatProvider apiRoute={config.routes.api} instance={instance} serverURL={config.serverURL}>
			{children}
		</ChatProvider>
	)
}
