import { readFileSync } from 'node:fs'

let cached: string | null | undefined

/**
 * This package's own version, sent with each recording so the team knows which plugin release a
 * site runs. `dist/` mirrors `src/`, so the manifest sits two levels up from either. Best-effort:
 * a bundler that moves this file just means no version is sent.
 */
export const pluginVersion = (): string | null => {
	if (cached !== undefined) return cached
	try {
		const manifest = JSON.parse(
			readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
		) as { name?: unknown; version?: unknown }
		cached =
			manifest.name === '@10x-media/feedback-recorder' && typeof manifest.version === 'string'
				? manifest.version
				: null
	} catch {
		cached = null
	}
	return cached
}
