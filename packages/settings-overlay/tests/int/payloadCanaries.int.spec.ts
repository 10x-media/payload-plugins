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

	it('the action components are still absent from the client barrel', async () => {
		const clientExports = await readDist('@payloadcms/ui/dist/exports/client/index.d.ts')

		// `client/documentActions.tsx` rewrites delete, duplicate and restore rather than reusing
		// Payload's components. Not by preference: `exports/client` is a bundled artifact with its
		// own copy of every provider, so a component pulled in through `@payloadcms/ui/elements/*`
		// reads a second, never-mounted context and throws. Exporting them from the barrel is what
		// would let that file shrink to a menu.
		expect(clientExports).toContain('DocumentControls')
		expect(clientExports).not.toContain('DeleteDocument')
		expect(clientExports).not.toContain('RestoreButton')
	})

	it('the client barrel is still a bundle, which is why subpath imports cannot be used', async () => {
		const barrel = await readDist('@payloadcms/ui/dist/exports/client/index.js')
		const unbundled = await readDist('@payloadcms/ui/dist/elements/DeleteDocument/index.js')

		// Two builds of the same code. The barrel inlines its providers into local chunks; the
		// unbundled tree imports `dist/providers/*` by relative path. The admin mounts the former,
		// so the latter's hooks answer from contexts nothing ever provided.
		expect(barrel).toMatch(/from"\.\/chunk-[A-Z0-9]+\.js"/)
		expect(unbundled).toContain("from '../../providers/Config/index.js'")
	})
})
