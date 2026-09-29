import type { JSXConverterArgs, JSXConvertersFunction } from '@payloadcms/richtext-lexical/react'

const COLORS: Record<string, string> = {
	amber: '#f5a524',
	black: '#000',
	green: '#17c964',
	red: '#f31260',
}

/**
 * Banner converters for the dev app's `swatch` inline block. Rendered on the
 * server with the banner, so this module is not a client component.
 * `inlineBlocks` is a map of its own; spreading the plugin's keeps any it has.
 */
export const lockConverters: JSXConvertersFunction = ({ defaultConverters }) => ({
	...defaultConverters,
	inlineBlocks: {
		...defaultConverters.inlineBlocks,
		swatch: ({ node }: JSXConverterArgs) => {
			const color = (node as { fields?: { color?: string } }).fields?.color ?? 'black'
			return (
				<span
					data-dev-converter="swatch"
					style={{
						background: COLORS[color] ?? COLORS.black,
						border: '1px solid rgb(255 255 255 / 0.4)',
						display: 'inline-block',
						height: '0.8em',
						margin: '0 0.25em',
						verticalAlign: '-0.05em',
						width: '0.8em',
					}}
				/>
			)
		},
	},
})
