import type { ServerFunction } from 'payload'
import type React from 'react'

import { LAZY_FUNCTION_NAME } from '../plugin/constants'
import { type LazyItemRequest, renderLazyItem } from './renderLazyItem'

/**
 * The opt-in transport, for `lazyTransport: 'server-function'`.
 *
 * Payload has no config-level way to register a server function: extras reach
 * `handleServerFunctions` only through its own argument, which lives in the host's generated
 * `app/(payload)/layout.tsx`. This is therefore the one contract-backed route, and the price is
 * that the consumer wires it themselves:
 *
 * ```ts title="app/(payload)/layout.tsx"
 * import { settingsOverlayServerFunctions } from '@10x-media/settings-overlay/rsc'
 *
 * const serverFunction: ServerFunctionClient = async (args) => {
 *   'use server'
 *   return handleServerFunctions({
 *     ...args,
 *     config,
 *     importMap,
 *     serverFunctions: settingsOverlayServerFunctions,
 *   })
 * }
 * ```
 *
 * In exchange the plugin registers no dashboard widget at all. Which trade is right depends on
 * whether a stray row in the "Add widget" drawer bothers you more than editing one generated
 * file; neither answer is wrong, which is why this is an option rather than a default.
 */
export const settingsOverlayRenderItem: ServerFunction<
	LazyItemRequest,
	Promise<{ Item: React.ReactNode }>
> = async ({ itemSlug, locale, overlayId, permissions, req, searchParams }) => ({
	Item: await renderLazyItem({ itemSlug, locale, overlayId, permissions, req, searchParams }),
})

/**
 * Pass as `serverFunctions` to `handleServerFunctions`. Payload's own functions stay untouched;
 * this adds one name beside them.
 */
export const settingsOverlayServerFunctions = {
	[LAZY_FUNCTION_NAME]: settingsOverlayRenderItem,
} as unknown as Record<string, ServerFunction>
