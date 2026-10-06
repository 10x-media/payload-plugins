import type React from 'react'

/** A plain SVG icon, to show that `icon` takes a component rather than an icon-pack name. */
export const GearIcon: React.FC = () => (
	<svg aria-hidden fill="none" height="18" viewBox="0 0 24 24" width="18">
		<title>Settings</title>
		<circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
		<path
			d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10 2.1 2.1M19.1 4.9 17 7m-10 10-2.1 2.1"
			stroke="currentColor"
			strokeLinecap="round"
			strokeWidth="2"
		/>
	</svg>
)
