'use client'

import {
	type ComposerFeature,
	type ComposerToolbarItemProps,
	defineComposerFeature,
} from '@10x-media/conversations/composer'
import {
	$getSelection,
	$isRangeSelection,
	FORMAT_TEXT_COMMAND,
	type LexicalEditor,
} from '@payloadcms/richtext-lexical/lexical'
import {
	$getSelectionStyleValueForProperty,
	$patchStyleText,
} from '@payloadcms/richtext-lexical/lexical/selection'
import { type JSXConverters, TextJSXConverter } from '@payloadcms/richtext-lexical/react'

/**
 * A project's own rich text feature, in two halves that travel together:
 * `textColorFeature` for the composer (a toolbar palette and one `/` command
 * per colour, storing a `color` style on text nodes) and
 * `textColorConverters` for showing messages (Payload's text converter plus
 * the colour). The same file serves the admin (`ChatRichTextProvider`) and
 * the website (`ConversationUIProvider`).
 */

const COLORS = [
	{ key: 'red', label: 'Red', value: '#e5484d' },
	{ key: 'amber', label: 'Amber', value: '#f5a623' },
	{ key: 'green', label: 'Green', value: '#30a46c' },
	{ key: 'blue', label: 'Blue', value: '#3e63dd' },
	{ key: 'violet', label: 'Violet', value: '#8e4ec6' },
]

const setColor = (editor: LexicalEditor, color: null | string) => {
	editor.update(() => {
		const selection = $getSelection()
		if ($isRangeSelection(selection)) $patchStyleText(selection, { color })
	})
	editor.focus()
}

const PaletteIcon = () => (
	<svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16">
		<path
			d="M4.5 12.5L8 3.5l3.5 9M5.8 9.5h4.4"
			stroke="currentColor"
			strokeLinecap="round"
			strokeWidth="1.4"
		/>
		<path d="M3 14.5h10" stroke="#e5484d" strokeLinecap="round" strokeWidth="1.8" />
	</svg>
)

const Swatch = ({ color }: { color: string }) => (
	<span
		style={{ background: color, borderRadius: 3, display: 'inline-block', height: 14, width: 14 }}
	/>
)

/** The dropdown's custom UI: a row of swatches and a reset. */
const Palette = ({ close, editor }: ComposerToolbarItemProps) => (
	<div style={{ display: 'flex', gap: 6, padding: '6px 8px' }}>
		{COLORS.map((color) => (
			<button
				aria-label={color.label}
				key={color.key}
				onClick={() => {
					setColor(editor, color.value)
					close()
				}}
				onMouseDown={(event) => event.preventDefault()}
				style={{ background: 'none', border: 0, cursor: 'pointer', padding: 2 }}
				title={color.label}
				type="button"
			>
				<Swatch color={color.value} />
			</button>
		))}
		<button
			onClick={() => {
				setColor(editor, null)
				close()
			}}
			onMouseDown={(event) => event.preventDefault()}
			style={{
				background: 'none',
				border: 0,
				color: 'var(--theme-elevation-600)',
				cursor: 'pointer',
				fontSize: 12,
			}}
			type="button"
		>
			Reset
		</button>
	</div>
)

export const textColorFeature = () =>
	defineComposerFeature({
		key: 'textColor',
		slashMenu: {
			groups: [
				{
					items: COLORS.map((color) => ({
						Icon: () => <Swatch color={color.value} />,
						key: `color-${color.key}`,
						keywords: ['color', 'colour', color.key],
						label: `${color.label} text`,
						onSelect: ({ editor }: { editor: LexicalEditor }) => setColor(editor, color.value),
					})),
					key: 'color',
					label: 'Color',
				},
			],
		},
		toolbar: {
			groups: [
				{
					ChildComponent: PaletteIcon,
					items: [
						{
							Component: Palette,
							isActive: ({ selection }) =>
								$isRangeSelection(selection) &&
								$getSelectionStyleValueForProperty(selection, 'color', '') !== '',
							key: 'palette',
							label: 'Text color',
						},
					],
					key: 'color',
					label: 'Text color',
					order: 15,
					type: 'dropdown',
				},
			],
		},
	})

const formats = [
	{ format: 'underline', key: 'underline', label: 'Underline', text: 'U' },
	{ format: 'strikethrough', key: 'strike', label: 'Strikethrough', text: 'S' },
	{ format: 'code', key: 'code', label: 'Inline code', text: '<>' },
	{ format: 'subscript', key: 'sub', label: 'Subscript', text: 'x₂' },
	{ format: 'superscript', key: 'sup', label: 'Superscript', text: 'x²' },
] as const

/** More buttons in the `format` group, to show the toolbar's "More" overflow. */
export const extraFormatsFeature = () =>
	defineComposerFeature({
		key: 'extraFormats',
		toolbar: {
			groups: [
				{
					items: formats.map((entry, index) => ({
						ChildComponent: () => (
							<span style={{ fontSize: 12, fontWeight: 600 }}>{entry.text}</span>
						),
						isActive: ({ selection }) =>
							$isRangeSelection(selection) && selection.hasFormat(entry.format),
						key: entry.key,
						label: entry.label,
						onSelect: ({ editor }) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, entry.format),
						order: 30 + index,
					})),
					key: 'format',
					type: 'buttons',
				},
			],
		},
	})

/** Only a palette colour survives: the stored `style` is user input. */
const colorOf = (style: unknown): null | string => {
	const match = typeof style === 'string' ? /(?:^|;)\s*color:\s*([^;]+)/.exec(style) : null
	const value = match?.[1]?.trim().toLowerCase()
	return COLORS.some((color) => color.value === value) ? (value ?? null) : null
}

/** Shows the colour on sent messages; bold, italic and the rest stay Payload's. */
export const textColorConverters: JSXConverters = {
	text: (args) => {
		// A converter is a function or a ready node.
		const base = TextJSXConverter.text
		const rendered = typeof base === 'function' ? base(args as never) : base
		const color = colorOf((args.node as { style?: unknown }).style)
		return color ? <span style={{ color }}>{rendered}</span> : rendered
	},
}

/** The default features plus text colour: pass as `composerFeatures`. */
export const withTextColor = ({ defaultFeatures }: { defaultFeatures: ComposerFeature[] }) => [
	...defaultFeatures,
	textColorFeature(),
]
