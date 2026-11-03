// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { withPayload } from '@payloadcms/tanstack-start'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import rsc from '@vitejs/plugin-rsc'
import { defineConfig } from 'vite'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * The plugin's second dev app, on TanStack Start (`pnpm dev:tanstack <name>`). It serves the Next
 * dev app's config and public files, on :3001 so both can run at once. `PORT` wins, which is how
 * `scripts/run.ts` moves a worktree's server off the primary checkout's ports.
 */
export default defineConfig(
	withPayload(
		({ pluginOptions }) => ({
			plugins: [
				rsc(pluginOptions.rsc),
				tanstackStart(pluginOptions.tanstackStart),
				viteReact(pluginOptions.react),
			],
			publicDir: path.resolve(dirname, '../dev/public'),
			resolve: {
				alias: {
					'@/': `${path.resolve(dirname, 'src')}/`,
				},
			},
			server: {
				port: Number(process.env.PORT ?? 3001),
				warmup: {
					clientFiles: [
						'./src/app/__root.tsx',
						'./src/app/_payload.tsx',
						'./src/app/_payload/admin.index.tsx',
						'./src/app/_payload/admin.$.tsx',
					],
				},
			},
		}),
		{
			// The dev config's in-memory MongoDB (`dev/helpers/memoryDb.ts`) is CommonJS, which the
			// RSC plugin's CJS-to-ESM rewrite breaks (`__cjs_module_runner_transform`); Node loads it
			// as is instead. Dev serve only: a build bundles CommonJS fine.
			devServerExternalPackages: ['mongodb-memory-server', 'mongodb-memory-server-core'],
			payloadConfigPath: path.resolve(dirname, 'src', 'payload.config.ts'),
		}
	)
)
