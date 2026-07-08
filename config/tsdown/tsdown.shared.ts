import { defineConfig } from 'tsdown'

type PluginBuildOptions = {
	entry: Record<string, string>
}

/**
 * Shared build for published plugins: per-file ESM output mirroring src/, the
 * same shape Payload's own plugin template ships. Bundling into shared chunks
 * would drop 'use client' directives from non-entry files and break RSC
 * boundaries when Next.js imports a component through such a chunk, and it
 * silently inlines undeclared dependencies; per-file output makes both
 * failure modes impossible and keeps published files diffable across releases.
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
		// Rolldown's default sanitizer rewrites '+' to '_' in preserved-module
		// names, so a checkout path containing '+' no longer matches
		// preserveModulesRoot and [name] becomes a rejected ../.. traversal.
		// Names here are src-relative file paths, already URL-safe.
		outputOptions: {
			sanitizeFileName: false,
		},
	})
