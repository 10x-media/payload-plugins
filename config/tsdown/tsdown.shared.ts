import { defineConfig, type UserConfig } from 'tsdown'

type PluginBuildOptions = {
	entry: Record<string, string>
	copy?: UserConfig['copy']
}

/**
 * Shared build for published plugins: per-file ESM output mirroring src/, the
 * same shape Payload's own plugin template ships. Bundling into shared chunks
 * would drop 'use client' directives from non-entry files and break RSC
 * boundaries when Next.js imports a component through such a chunk, and it
 * silently inlines undeclared dependencies; per-file output makes both
 * failure modes impossible and keeps published files diffable across releases.
 *
 * CSS imported by client components stays external and is copied verbatim via
 * `copy` (the Payload copyfiles pattern): the consumer's Next bundler resolves
 * the import from dist, so no css processing happens at build time.
 *
 * `next/*` is external by pattern as well. Resolved rather than externalized, a
 * subpath is rewritten to the file it landed on (`next/navigation.js`), which
 * only works because Next ships no exports map; the bare specifier is what the
 * consumer's bundler is meant to see.
 */
export const definePluginBuild = (options: PluginBuildOptions) =>
	defineConfig({
		entry: options.entry,
		format: 'esm',
		dts: true,
		clean: true,
		unbundle: true,
		sourcemap: true,
		fixedExtension: false,
		external: [/\.css$/, /^next(\/|$)/],
		copy: options.copy,
		// Rolldown's default sanitizer rewrites '+' to '_' in preserved-module
		// names, so a checkout path containing '+' no longer matches
		// preserveModulesRoot and [name] becomes a rejected ../.. traversal.
		// Names here are src-relative file paths, already URL-safe.
		outputOptions: {
			sanitizeFileName: false,
		},
	})
