import { defineConfig } from 'tsdown'

/**
 * Rolldown strips 'use client' / 'use server' directives from shared chunks
 * (non-entry files). This plugin restores them: the transform hook records
 * which modules carried a directive, and renderChunk re-injects it when any
 * module in the chunk originally had one. Without this, Next.js cannot see
 * the RSC/client boundary when it imports a shared chunk from the rsc bundle.
 */
const preserveDirectives = () => {
	const directiveModules = new Map<string, string>()
	return {
		name: 'preserve-directives',
		transform(code: string, id: string) {
			const trimmed = code.trimStart()
			const match = /^(['"])use (client|server)\1/.exec(trimmed)
			if (match) {
				directiveModules.set(id, `${match[1]}use ${match[2]}${match[1]}`)
			}
			return null
		},
		renderChunk(code: string, chunk: { modules?: Record<string, unknown> }) {
			const directive = Object.keys(chunk.modules ?? {})
				.map((id) => directiveModules.get(id))
				.find(Boolean)
			if (!directive) {
				return null
			}
			const trimmed = code.trimStart()
			if (
				trimmed.startsWith("'use client'") ||
				trimmed.startsWith('"use client"') ||
				trimmed.startsWith("'use server'") ||
				trimmed.startsWith('"use server"')
			) {
				return null
			}
			return { code: `${directive};\n${code}` }
		},
	}
}

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		'exports/types': 'src/exports/types.ts',
		'exports/client': 'src/exports/client.ts',
		'exports/i18n': 'src/exports/i18n.ts',
		'testing/memoryAdapter': 'src/testing/memoryAdapter.ts',
		'exports/geo': 'src/exports/geo.ts',
		'exports/rsc': 'src/exports/rsc.ts',
		'exports/adapters/native': 'src/exports/adapters/native.ts',
		'exports/adapters/plausible': 'src/exports/adapters/plausible.ts',
		'exports/adapters/umami': 'src/exports/adapters/umami.ts',
		'exports/adapters/ga4': 'src/exports/adapters/ga4.ts',
		'exports/adapters/posthog': 'src/exports/adapters/posthog.ts',
	},
	format: 'esm',
	dts: true,
	clean: true,
	treeshake: true,
	sourcemap: true,
	fixedExtension: false,
	plugins: [preserveDirectives()],
})
