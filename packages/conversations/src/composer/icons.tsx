/** Composer icons: 16px strokes on `currentColor`. */

const Svg = ({ children }: { children: React.ReactNode }) => (
	<svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16">
		{children}
	</svg>
)

export const BoldIcon = () => (
	<Svg>
		<path
			d="M4.5 2.75h4.25a2.63 2.63 0 0 1 0 5.25H4.5zM4.5 8h4.9a2.63 2.63 0 0 1 0 5.25H4.5z"
			stroke="currentColor"
			strokeLinejoin="round"
			strokeWidth="1.6"
		/>
	</Svg>
)

export const ItalicIcon = () => (
	<Svg>
		<path
			d="M6.5 2.75h5M4.5 13.25h5M9.75 2.75l-3.5 10.5"
			stroke="currentColor"
			strokeLinecap="round"
			strokeWidth="1.4"
		/>
	</Svg>
)

export const LinkIcon = () => (
	<Svg>
		<path
			d="M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2.12-2.12a2.5 2.5 0 0 0-3.54-3.54l-.7.7M9.25 6.75a2.5 2.5 0 0 0-3.54 0L3.59 8.87a2.5 2.5 0 0 0 3.54 3.54l.7-.7"
			stroke="currentColor"
			strokeLinecap="round"
			strokeWidth="1.4"
		/>
	</Svg>
)

export const AtIcon = () => (
	<Svg>
		<circle cx="8" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.4" />
		<path
			d="M10.4 8v1a1.6 1.6 0 0 0 3.2 0V8a5.6 5.6 0 1 0-2.2 4.45"
			stroke="currentColor"
			strokeLinecap="round"
			strokeWidth="1.4"
		/>
	</Svg>
)

export const BulletListIcon = () => (
	<Svg>
		<circle cx="3" cy="4" fill="currentColor" r="1" />
		<circle cx="3" cy="8" fill="currentColor" r="1" />
		<circle cx="3" cy="12" fill="currentColor" r="1" />
		<path
			d="M6 4h7.5M6 8h7.5M6 12h7.5"
			stroke="currentColor"
			strokeLinecap="round"
			strokeWidth="1.4"
		/>
	</Svg>
)

export const NumberedListIcon = () => (
	<Svg>
		<path
			d="M2.5 3h1v3M2.25 6h1.75M2.25 9.75a1 1 0 0 1 1.75.5c0 .75-1.75 1.5-1.75 2.25H4"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.1"
		/>
		<path
			d="M6.5 4.5h7M6.5 8h7M6.5 11.5h7"
			stroke="currentColor"
			strokeLinecap="round"
			strokeWidth="1.4"
		/>
	</Svg>
)

export const LockIcon = () => (
	<Svg>
		<rect height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.3" width="9" x="3.5" y="7" />
		<path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.3" />
	</Svg>
)

export const EyeIcon = () => (
	<Svg>
		<path
			d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z"
			stroke="currentColor"
			strokeLinejoin="round"
			strokeWidth="1.3"
		/>
		<circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
	</Svg>
)

export const CheckIcon = () => (
	<Svg>
		<path
			d="M3.5 8.5l3 3 6-7"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.5"
		/>
	</Svg>
)

export const PencilIcon = () => (
	<Svg>
		<path
			d="M10.5 3.25l2.25 2.25-7 7H3.5v-2.25zM9.25 4.5l2.25 2.25"
			stroke="currentColor"
			strokeLinejoin="round"
			strokeWidth="1.3"
		/>
	</Svg>
)

export const CrossIcon = () => (
	<Svg>
		<path
			d="M4.5 4.5l7 7M11.5 4.5l-7 7"
			stroke="currentColor"
			strokeLinecap="round"
			strokeWidth="1.4"
		/>
	</Svg>
)
