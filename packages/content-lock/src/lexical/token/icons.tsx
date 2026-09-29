'use client'

import type { ReactNode } from 'react'

import type { TokenKind } from './types'

const Svg = ({ children }: { children: ReactNode }) => (
	<svg
		aria-hidden="true"
		className="icon"
		fill="none"
		focusable="false"
		height="20"
		stroke="currentColor"
		strokeLinecap="round"
		strokeLinejoin="round"
		strokeWidth="1.5"
		viewBox="0 0 20 20"
		width="20"
		xmlns="http://www.w3.org/2000/svg"
	>
		{children}
	</svg>
)

/** Lock start: a clock with a play mark. */
const StartIcon = () => (
	<Svg>
		<circle cx="10" cy="10" r="6.5" />
		<path d="M8.75 7.5v5l4-2.5z" />
	</Svg>
)

/** Lock end: a clock with a stop mark. */
const EndIcon = () => (
	<Svg>
		<circle cx="10" cy="10" r="6.5" />
		<rect height="4" width="4" x="8" y="8" />
	</Svg>
)

/** Announcement: a bell. */
const AnnounceIcon = () => (
	<Svg>
		<path d="M6 13.5V9a4 4 0 0 1 8 0v4.5l1 1.5H5z" />
		<path d="M8.5 16.5a1.5 1.5 0 0 0 3 0" />
	</Svg>
)

/** Scope: stacked layers. */
const ScopeIcon = () => (
	<Svg>
		<path d="M10 4 3.5 7.25 10 10.5l6.5-3.25z" />
		<path d="m3.5 10.25 6.5 3.25 6.5-3.25" />
		<path d="m3.5 13.25 6.5 3.25 6.5-3.25" />
	</Svg>
)

/** Fixed date: a calendar. */
const DateIcon = () => (
	<Svg>
		<rect height="12" rx="1.5" width="13" x="3.5" y="5" />
		<path d="M3.5 8.5h13M7 3.5v3M13 3.5v3" />
	</Svg>
)

/** The menu icon for each kind of token. */
export const tokenIcons: Record<TokenKind, () => ReactNode> = {
	startsAt: StartIcon,
	endsAt: EndIcon,
	announceAt: AnnounceIcon,
	scope: ScopeIcon,
	date: DateIcon,
}
