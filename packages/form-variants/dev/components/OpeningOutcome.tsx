'use client'

import { useFormVariants, useOutcome } from '@10x-media/form-variants/client'
import { Button, useConfig, useDocumentDrawerContext, useModal } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import type React from 'react'

import './dev.css'

/**
 * The `Outcome` slot for the publishing wizard. The plugin hands over whatever `afterSave`
 * returned and the surface it is on; what the screen offers next is the consumer's call, and it
 * is not the same call in a drawer as on the page.
 */
export const OpeningOutcome: React.FC = () => {
	const outcome = useOutcome()
	const { inDrawer } = useFormVariants()
	const { drawerSlug } = useDocumentDrawerContext()
	const { closeModal } = useModal()
	const {
		config: {
			routes: { admin },
		},
	} = useConfig()

	if (!outcome) {
		return null
	}

	const id = typeof outcome.id === 'string' ? outcome.id : null

	return (
		<section className="dev-outcome">
			<h2>{typeof outcome.title === 'string' ? outcome.title : 'Published'}</h2>
			{typeof outcome.message === 'string' && <p>{outcome.message}</p>}
			{typeof outcome.reference === 'string' && (
				<p className="dev-muted">Reference {outcome.reference}</p>
			)}
			<div className="dev-outcome__actions">
				{inDrawer ? (
					<Button buttonStyle="primary" onClick={() => closeModal(drawerSlug)} size="medium">
						Close
					</Button>
				) : (
					<>
						{id && (
							<Button
								buttonStyle="primary"
								el="link"
								size="medium"
								to={formatAdminURL({ adminRoute: admin, path: `/collections/openings/${id}` })}
							>
								Open the posting
							</Button>
						)}
						{/* A full load, so the create view starts over instead of keeping this outcome. */}
						<Button
							buttonStyle="secondary"
							el="anchor"
							size="medium"
							url={formatAdminURL({ adminRoute: admin, path: '/collections/openings/create' })}
						>
							Post another role
						</Button>
					</>
				)}
			</div>
		</section>
	)
}
