'use client'

import { FieldDescription } from '@payloadcms/ui'
import type { StaticDescription } from 'payload'

import { WikiFieldHelp } from './WikiFieldHelp'

export type WikiFieldDescriptionProps = {
	/** The field's original static description, preserved below the field. */
	description?: null | StaticDescription
	path?: string
	schemaPath: string
}

/**
 * Injected into `admin.components.Description` on every named field by the
 * config walker: renders the field's original description untouched, then the
 * wiki help surface (which itself renders nothing without a guide).
 */
export const WikiFieldDescription = ({
	description,
	path,
	schemaPath,
}: WikiFieldDescriptionProps) => (
	<>
		{description ? <FieldDescription description={description} path={path ?? schemaPath} /> : null}
		<WikiFieldHelp schemaPath={schemaPath} />
	</>
)
