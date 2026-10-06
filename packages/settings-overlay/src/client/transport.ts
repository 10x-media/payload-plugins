'use client'

import type { ServerFunctionClient } from 'payload'
import type React from 'react'

import { DISPATCHER_WIDGET_SLUG, LAZY_FUNCTION_NAME } from '../plugin/constants'

/**
 * How the panel asks the server to render an item that did not arrive with the page.
 *
 * The panel calls this and does not know which channel carried the result, which is the point:
 * adding or replacing a channel is a change to this file and to the server entry point it pairs
 * with, and to nothing else.
 */
export type LazyItemTransport = (args: {
	itemSlug: string
	overlayId: string
	searchParams: Record<string, string>
	serverFunction: ServerFunctionClient
}) => Promise<React.ReactNode>

/**
 * Payload throws a bare `Unknown Server Function: <name>` when a name is not in the table, which
 * says nothing about what to do. This turns it into the sentence the reader's developer needs.
 */
const explainMissingFunction = (error: unknown, name: string): never => {
	const message = error instanceof Error ? error.message : String(error)
	if (message.includes('Unknown Server Function')) {
		throw new Error(
			`[settings-overlay] the "${name}" server function is not registered. Either spread ` +
				'`settingsOverlayServerFunctions` into `handleServerFunctions` in ' +
				"app/(payload)/layout.tsx, or drop `lazyTransport: 'server-function'` from the " +
				'plugin options to go back to the widget transport, which needs no wiring.'
		)
	}
	throw error instanceof Error ? error : new Error(message)
}

/**
 * The default transport. Reaches the server through Payload's built-in `render-widget`, whose
 * handler renders a registered component with a real request. See `server/widgetDispatcher.tsx`
 * for what is being worked around and why this function in particular.
 */
export const widgetTransport: LazyItemTransport = async ({
	itemSlug,
	overlayId,
	searchParams,
	serverFunction,
}) => {
	try {
		const result = (await serverFunction({
			name: 'render-widget',
			args: {
				widgetData: { itemSlug, overlayId, searchParams },
				widgetSlug: DISPATCHER_WIDGET_SLUG,
			},
		})) as { component: React.ReactNode }

		return result?.component ?? null
	} catch (error) {
		return explainMissingFunction(error, 'render-widget')
	}
}

/**
 * The opt-in transport, for `lazyTransport: 'server-function'`. Calls the plugin's own function,
 * which exists only if the consumer registered it in their layout.
 */
export const serverFunctionTransport: LazyItemTransport = async ({
	itemSlug,
	overlayId,
	searchParams,
	serverFunction,
}) => {
	try {
		const result = (await serverFunction({
			name: LAZY_FUNCTION_NAME,
			args: { itemSlug, overlayId, searchParams },
		})) as { Item: React.ReactNode }

		return result?.Item ?? null
	} catch (error) {
		return explainMissingFunction(error, LAZY_FUNCTION_NAME)
	}
}

export const transportFor = (lazyTransport: 'server-function' | 'widget'): LazyItemTransport =>
	lazyTransport === 'server-function' ? serverFunctionTransport : widgetTransport
