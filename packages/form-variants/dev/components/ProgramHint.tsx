import type React from 'react'

import './dev.css'

/** A non-field component placed between the fields of a step, rendered on the server. */
export const ProgramHint: React.FC = () => (
	<p className="dev-hint">
		Add the talks in the order they happen. Speakers can be filled in later.
	</p>
)
