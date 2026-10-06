import type React from 'react'

/**
 * A project's own pictogram set, keyed by item slug.
 *
 * This is the case the `RailItem` slot exists for: the plugin knows nothing about these, and a
 * consumer should not have to fork the rail to use them.
 */
const paths: Record<string, string> = {
	audience:
		'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 19a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M16 19a6 6 0 0 0-1-3',
	billing: 'M2 7h20M2 7v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2ZM6 15h4',
	brand: 'M12 3 3 8v8l9 5 9-5V8l-9-5ZM12 12l9-4M12 12v9M12 12 3 8',
	domains: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z',
	keys: 'M14 7a4 4 0 1 1-3.5 5.9L4 19H2v-3l6.1-6.4A4 4 0 0 1 14 7ZM16 9h.01',
	members: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 19a6 6 0 0 1 12 0M18 8v6M21 11h-6',
	plan: 'M4 4h16v6H4zM4 14h7v6H4zM15 14h5v6h-5z',
	profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 20a8 8 0 0 1 16 0',
	webhooks:
		'M6 12a6 6 0 1 1 10 4.5M9 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 15h3',
}

export const Pictogram: React.FC<{ slug: string }> = ({ slug }) => {
	const path = paths[slug]
	if (!path) {
		return null
	}

	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="17"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.6"
			viewBox="0 0 24 24"
			width="17"
		>
			<path d={path} />
		</svg>
	)
}
