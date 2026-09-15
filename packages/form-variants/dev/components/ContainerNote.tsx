import type React from 'react'

import './dev.css'

/**
 * A non-field component nested inside a step's own container, which is the case that has to
 * reach the import map through the containers rather than from the top level of the step.
 */
export const ContainerNote: React.FC = () => (
	<p className="dev-hint">
		These fields sit in different containers on the native form. The step draws its own.
	</p>
)
