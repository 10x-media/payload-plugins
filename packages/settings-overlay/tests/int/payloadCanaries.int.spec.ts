import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * Two assumptions this plugin makes about Payload's internals. Both are workarounds, and both
 * tests are written to fail when the workaround stops being necessary, so the reason to delete
 * the code arrives as a red test rather than as a memory.
 *
 * Both read the installed files rather than importing them: `@payloadcms/next` does not export
 * its own `package.json`, and importing `@payloadcms/ui` in Node pulls stylesheets a test runner
 * cannot load. The published surface is what these assertions are about anyway.
 */
const readDist = (relative: string): Promise<string> =>
	readFile(new URL(`../../node_modules/${relative}`, import.meta.url), 'utf8')

describe('payload canaries', () => {
	it('render-widget is still a built-in server function', async () => {
		const source = await readDist('@payloadcms/next/dist/utilities/handleServerFunctions.js')

		// `client/transport.ts` and `server/widgetDispatcher.tsx` ride this name. If it goes, the
		// lazy tier needs a new channel.
		expect(source).toContain("'render-widget'")
		expect(source).toContain('renderWidgetHandler')
	})

	it('DocumentDrawerContextProvider is still not exported, so the delete workaround stays', async () => {
		const clientExports = await readDist('@payloadcms/ui/dist/exports/client/index.d.ts')

		// When this flips, delete `client/documentActions.tsx`, drop `disableActions` from
		// `renderDocumentArgs`, and let the edit view report delete and create through the drawer
		// callbacks instead.
		expect(clientExports).toContain('useDocumentDrawerContext')
		expect(clientExports).not.toContain('DocumentDrawerContextProvider')
	})
})
