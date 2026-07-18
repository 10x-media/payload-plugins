import type { CustomIconSource } from '@10x-media/fields/icon/codegen'

/**
 * A hand-authored BYO icon library: simple outline social glyphs on lucide's
 * 24x24 stroke canvas, so the drawer renders them through the shared DrawerGlyph
 * exactly like the built-in libraries. Generic geometry, not trademarked marks.
 * Feeds the codegen custom source; run `pnpm --filter @10x-media/fields generate:social`
 * to re-emit `generated/manifest.ts` and `generated/nodes.ts` (byte-stable).
 */
export const socialSource: CustomIconSource = {
	icons: [
		{ name: 'facebook', tags: ['meta', 'social', 'connect'], categories: ['brands'] },
		{ name: 'instagram', tags: ['meta', 'photos', 'social'], categories: ['brands'] },
		{ name: 'linkedin', tags: ['work', 'professional', 'social'], categories: ['brands'] },
		{ name: 'telegram', tags: ['messaging', 'chat', 'social'], categories: ['brands'] },
		{ name: 'x', tags: ['twitter', 'social', 'post'], categories: ['brands'] },
		{ name: 'youtube', tags: ['video', 'watch', 'social'], categories: ['brands'] },
	],
	nodes: {
		facebook: [
			['circle', { cx: '12', cy: '12', r: '9' }],
			['path', { d: 'M14 8.5h-1.5a1.5 1.5 0 0 0-1.5 1.5V17' }],
			['line', { x1: '9.5', y1: '12.5', x2: '13.5', y2: '12.5' }],
		],
		instagram: [
			['rect', { x: '3', y: '3', width: '18', height: '18', rx: '5' }],
			['circle', { cx: '12', cy: '12', r: '4' }],
			['line', { x1: '16.5', y1: '7.5', x2: '16.5', y2: '7.5' }],
		],
		linkedin: [
			['rect', { x: '3', y: '3', width: '18', height: '18', rx: '3' }],
			['line', { x1: '8', y1: '8', x2: '8', y2: '8' }],
			['line', { x1: '8', y1: '11', x2: '8', y2: '16' }],
			['path', { d: 'M12 16v-5m0 2a2.5 2.5 0 0 1 5 0v3' }],
		],
		telegram: [
			['path', { d: 'M22 4 11 15' }],
			['path', { d: 'M22 4 15 20 11 15 4 11z' }],
		],
		x: [
			['line', { x1: '5', y1: '5', x2: '19', y2: '19' }],
			['line', { x1: '19', y1: '5', x2: '5', y2: '19' }],
		],
		youtube: [
			['rect', { x: '2', y: '5', width: '20', height: '14', rx: '4' }],
			['polygon', { points: '10 9 16 12 10 15' }],
		],
	},
}
