import type { ReactNode } from 'react'

import './icons.css'

/**
 * The plugin's glyphs. Payload ships no book, help, or star icon, so these are
 * drawn to its own conventions: a 20x20 view box and `.stroke`/`.fill` classes
 * that `icons.css` resolves to `currentColor` with a non-scaling stroke, exactly
 * as `packages/ui/src/icons/*` do. Chevrons, plus, edit and x are Payload's and
 * are imported from `@payloadcms/ui` rather than redrawn here.
 */
export type WikiIconProps = {
	className?: string
	/** `small` is 12px, the size Payload uses inside pills and inline text. */
	size?: 'medium' | 'small'
}

const classes = (props: WikiIconProps, name: string): string =>
	['wiki-icon', `wiki-icon--${name}`, props.size === 'small' && 'wiki-icon--small', props.className]
		.filter(Boolean)
		.join(' ')

const Glyph = ({
	children,
	name,
	...props
}: WikiIconProps & { children: ReactNode; name: string }) => (
	<svg
		aria-hidden="true"
		className={classes(props, name)}
		viewBox="0 0 20 20"
		xmlns="http://www.w3.org/2000/svg"
	>
		{children}
	</svg>
)

/** An open book: the wiki's mark, used on guide triggers. */
export const BookIcon = (props: WikiIconProps) => (
	<Glyph {...props} name="book">
		<path
			className="stroke"
			d="M10 5.6C8.6 4.6 6.7 4.1 4.3 4.1c-.5 0-1 0-1.5.1v11.4c.5-.1 1-.1 1.5-.1 2.4 0 4.3.5 5.7 1.5 1.4-1 3.3-1.5 5.7-1.5.5 0 1 0 1.5.1V4.2c-.5-.1-1-.1-1.5-.1-2.4 0-4.3.5-5.7 1.5Z"
			strokeLinejoin="round"
		/>
		<path className="stroke" d="M10 5.9v10.7" />
	</Glyph>
)

/** A circled question mark: field-level help, where the book reads too heavy. */
export const HelpIcon = (props: WikiIconProps) => (
	<Glyph {...props} name="help">
		<circle className="stroke" cx="10" cy="10" r="7.5" />
		<path
			className="stroke"
			d="M7.7 7.8a2.3 2.3 0 1 1 3.4 2c-.7.4-1.1.8-1.1 1.6v.3"
			strokeLinecap="round"
		/>
		<circle className="fill" cx="10" cy="14.2" r="0.9" />
	</Glyph>
)

/** Two stacked plates: a block, where Payload's own icon set has none. */
export const BlockIcon = (props: WikiIconProps) => (
	<Glyph {...props} name="block">
		<rect className="stroke" height="5" rx="1" width="12.5" x="3.75" y="3.5" />
		<rect className="stroke" height="5" rx="1" width="12.5" x="3.75" y="11.5" />
	</Glyph>
)

/** A filled star: the featured flag, on cards and rows. */
export const StarIcon = (props: WikiIconProps) => (
	<Glyph {...props} name="star">
		<path
			className="fill"
			d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.85 5-4.45-2.4-4.45 2.4.85-5L2.8 8.1l5-.7Z"
		/>
	</Glyph>
)

const CALLOUT_GLYPHS: Record<string, ReactNode> = {
	danger: (
		<>
			<circle className="stroke" cx="10" cy="10" r="7.5" />
			<path className="stroke" d="M10 6.2v5.1" strokeLinecap="round" />
			<circle className="fill" cx="10" cy="13.9" r="0.9" />
		</>
	),
	info: (
		<>
			<circle className="stroke" cx="10" cy="10" r="7.5" />
			<path className="stroke" d="M10 9.2v4.6" strokeLinecap="round" />
			<circle className="fill" cx="10" cy="6.5" r="0.9" />
		</>
	),
	tip: (
		<>
			<path
				className="stroke"
				d="M10 2.9a4.7 4.7 0 0 0-2.7 8.5v1.7h5.4v-1.7A4.7 4.7 0 0 0 10 2.9Z"
				strokeLinejoin="round"
			/>
			<path className="stroke" d="M8.2 15.6h3.6M8.8 17.4h2.4" strokeLinecap="round" />
		</>
	),
	warning: (
		<>
			<path
				className="stroke"
				d="M10 3.2 17.4 16H2.6Z"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path className="stroke" d="M10 8v3.7" strokeLinecap="round" />
			<circle className="fill" cx="10" cy="13.9" r="0.9" />
		</>
	),
}

/** Callout variant glyphs, matching the four GitHub-alert levels. */
export const CalloutIcon = ({ variant, ...props }: WikiIconProps & { variant: string }) => (
	<Glyph {...props} name="callout">
		{CALLOUT_GLYPHS[variant] ?? CALLOUT_GLYPHS.info}
	</Glyph>
)
