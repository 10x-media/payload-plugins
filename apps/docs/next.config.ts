import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMDX } from 'fumadocs-mdx/next'
import type { NextConfig } from 'next'

const withMDX = createMDX()

const config: NextConfig = {
	reactStrictMode: true,
	output: 'export',
	images: { unoptimized: true },
	// Pin the workspace root so Turbopack does not infer it from a parent
	// lockfile (wrong in git worktrees nested inside another checkout).
	turbopack: { root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..') },
}

export default withMDX(config)
