import type { Payload, PayloadComponent } from 'payload'
import { getFromImportMap, isReactServerComponentOrFunction } from 'payload/shared'
import type { ComponentType, ReactNode } from 'react'

import { ChatAdminProvider } from '../client/ChatAdminProvider'
import type { ChatComponents, ChatSlotName, ChatSlotProps } from '../client/components'
import { getInstance } from '../server/service'

const resolve = (payload: Payload, component: PayloadComponent) =>
	getFromImportMap<ComponentType<ChatSlotProps>>({
		importMap: payload.importMap,
		PayloadComponent: component,
		schemaPath: '',
		silent: true,
	})

/**
 * The admin provider of one instance, registered in
 * `admin.components.providers`. Resolves the config-level components (message
 * type `Component`s and `slots`) from the import map on the server: client
 * components travel to the browser as references, server components are
 * listed by name and rendered on demand through `render-widget`.
 */
export const ChatAdminProviderServer = ({
	children,
	instance: slug,
	payload,
}: {
	children?: ReactNode
	instance: string
	payload: Payload
}) => {
	const instance = getInstance({ payload } as never, slug)
	const components: ChatComponents = { server: { slots: [], types: [] }, slots: {}, types: {} }
	for (const [name, path] of Object.entries(instance.slots) as Array<
		[ChatSlotName, PayloadComponent | undefined]
	>) {
		const Component = path ? resolve(payload, path) : undefined
		if (!Component) continue
		if (isReactServerComponentOrFunction(Component)) components.server.slots.push(name)
		else components.slots[name] = Component
	}
	for (const type of instance.types.values()) {
		const Component = type.Component ? resolve(payload, type.Component) : undefined
		if (!Component) continue
		if (isReactServerComponentOrFunction(Component)) components.server.types.push(type.slug)
		else components.types[type.slug] = Component
	}
	return (
		<ChatAdminProvider components={components} instance={slug}>
			{children}
		</ChatAdminProvider>
	)
}
