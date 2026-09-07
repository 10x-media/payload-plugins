import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * Three assumptions this plugin makes about Payload's internals. Each is written to fail when
 * the assumption stops holding, so the reason to change the code arrives as a red test rather
 * than as a memory.
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

	it('DocumentDrawerContextProvider is still not exported, so the panel keeps its own menu', async () => {
		const clientExports = await readDist('@payloadcms/ui/dist/exports/client/index.d.ts')

		// The edit view reads its callbacks from a context only Payload can provide, so the pane
		// renders with `disableActions` and `client/documentActions.tsx` supplies its own menu.
		// When this flips, that file and the `disableActions` flag in `renderDocumentArgs` both go
		// and the edit view reports delete, duplicate and restore through the drawer callbacks.
		expect(clientExports).toContain('useDocumentDrawerContext')
		expect(clientExports).not.toContain('DocumentDrawerContextProvider')
	})

	it('the action components the pane borrows are still reachable by subpath', async () => {
		// `client/documentActions.tsx` imports these four from `@payloadcms/ui/elements/*` rather
		// than reimplementing them, so their logic stays Payload's. A rename breaks the build; a
		// dropped export map entry would not, which is what this checks.
		const exportMap = JSON.parse(await readDist('@payloadcms/ui/package.json')) as {
			exports: Record<string, unknown>
		}

		expect(exportMap.exports['./elements/*']).toBeDefined()

		for (const element of [
			'DeleteDocument',
			'DuplicateDocument',
			'PermanentlyDeleteButton',
			'RestoreButton',
		]) {
			await expect(
				readDist(`@payloadcms/ui/dist/elements/${element}/index.d.ts`)
			).resolves.toContain(element)
		}
	})
})
