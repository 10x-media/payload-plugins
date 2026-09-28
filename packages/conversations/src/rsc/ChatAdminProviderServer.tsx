import type { Payload, PayloadComponent } from 'payload'
import { getFromImportMap, isReactServerComponentOrFunction } from 'payload/shared'
import type { ComponentType, ReactNode } from 'react'

import { ChatAdminProvider } from '../client/ChatAdminProvider'
import {
	type ChatComponents,
	type ChatSlotEntry,
	type ChatSlotName,
	type ChatSlotProps,
	type ReplaceableName,
	SERVER_SLOT,
} from '../client/components'
import type { ClientTransportFactory } from '../react/transportFromSpec'
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
 * type `Component`s, `slots`, `components.Message`) from the import map on the server: client
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
	const components: ChatComponents = { replace: {}, server: { types: [] }, slots: {}, types: {} }
	for (const [name, paths] of Object.entries(instance.slots) as Array<
		[ChatSlotName, PayloadComponent[]]
	>) {
		const entries: ChatSlotEntry[] = []
		for (const path of paths) {
			const Component = resolve(payload, path)
			if (!Component) continue
			entries.push(isReactServerComponentOrFunction(Component) ? SERVER_SLOT : Component)
		}
		if (entries.length > 0) components.slots[name] = entries
	}
	for (const [name, path] of Object.entries(instance.components) as Array<
		[ReplaceableName, PayloadComponent | undefined]
	>) {
		const Component = path ? resolve(payload, path) : undefined
		if (!Component) continue
		if (isReactServerComponentOrFunction(Component)) {
			payload.logger.warn(
				`[@10x-media/conversations] components.${name} of "${slug}" is a server component; it must be a client component ('use client'). Using the default.`
			)
			continue
		}
		;(components.replace as Record<string, unknown>)[name] = Component
	}
	for (const type of instance.types.values()) {
		const Component = type.Component ? resolve(payload, type.Component) : undefined
		if (!Component) continue
		if (isReactServerComponentOrFunction(Component)) components.server.types.push(type.slug)
		else components.types[type.slug] = Component
	}
	const transport = instance.transport?.client ?? 'polling'
	// A client reference: a `'use client'` export travels to the browser like a component.
	const transportFactory =
		typeof transport === 'object' && 'factory' in transport
			? getFromImportMap<ClientTransportFactory>({
					importMap: payload.importMap,
					PayloadComponent: transport.factory,
					schemaPath: '',
					silent: true,
				})
			: null
	return (
		<ChatAdminProvider
			components={components}
			instance={slug}
			transport={transport}
			transportFactory={transportFactory}
		>
			{children}
		</ChatAdminProvider>
	)
}
