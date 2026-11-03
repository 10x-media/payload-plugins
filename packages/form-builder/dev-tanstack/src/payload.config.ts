import path from 'node:path'
import { fileURLToPath } from 'node:url'
import devConfig from '../../dev/payload.config'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * The Next dev app's config (`dev/payload.config.ts`), served by TanStack Start. Only the import
 * map moves: this app keeps its own next to its routes, generated against the same `baseDir`, so
 * component paths in the shared config keep resolving from `dev/`.
 */
const config = await devConfig

export default {
	...config,
	admin: {
		...config.admin,
		importMap: {
			...config.admin.importMap,
			importMapFile: path.resolve(dirname, 'app/_payload/importMap.js'),
		},
	},
}
