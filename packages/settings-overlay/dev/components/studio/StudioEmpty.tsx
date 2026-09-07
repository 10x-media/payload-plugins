import type React from 'react'

import './studio.css'

/** A replaced empty state. Static, so it needs no hooks and stays a server component. */
export const StudioEmpty: React.FC = () => (
	<div className="studio-empty">
		<p className="studio-empty__title">Nothing selected</p>
		<p className="studio-empty__body">Pick something from the rail to get started.</p>
	</div>
)
