'use client'

import { FieldDescription } from '@payloadcms/ui'
import type { StaticDescription } from 'payload'

import { WikiFieldPickTarget } from '../FieldPicker/WikiFieldPickTarget'
import { useWikiFieldPicker } from '../FieldPicker/WikiPickerContext'
import { WikiFieldHelp } from './WikiFieldHelp'

export type WikiFieldDescriptionProps = {
	/** The field's original static description, preserved below the field. */
	description?: null | StaticDescription
	path?: string
	schemaPath: string
}

/**
 * Injected into `admin.components.Description` on every named field by the
 * config walker: renders the field's original description untouched, then
 * whichever wiki surface belongs there.
 *
 * On a document that is the help surface, which itself renders nothing without a
 * guide. Inside the field picker's drawer it is the select plate instead: the
 * picker renders the host's real fields, so this same component is what every
 * one of them carries, and the picker context is how it learns which of the two
 * it is.
 */
export const WikiFieldDescription = ({
	description,
	path,
	schemaPath,
}: WikiFieldDescriptionProps) => {
	const picker = useWikiFieldPicker()

	return (
		<>
			{description ? (
				<FieldDescription description={description} path={path ?? schemaPath} />
			) : null}
			{picker ? (
				<WikiFieldPickTarget schemaPath={schemaPath} />
			) : (
				<WikiFieldHelp schemaPath={schemaPath} />
			)}
		</>
	)
}
