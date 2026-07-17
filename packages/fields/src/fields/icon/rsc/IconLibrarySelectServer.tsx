import type { TextFieldServerProps } from 'payload'
import type { ReactNode } from 'react'
import type { IconAdapter } from '../../../types'
import { IconLibrarySelect } from '../client/IconLibrarySelect'
import { getIconLibraryOptions } from '../server/libraryOptions'
import { resolveStaticLabel } from './resolveStaticLabel'

type ServerProps = { adapters?: IconAdapter[] } & TextFieldServerProps

/** Resolves selectable library options (inline beats registry) and renders the client select. */
export const IconLibrarySelectServer = (props: ServerProps): ReactNode => {
	const { clientField, i18n, path, payload, permissions, readOnly, schemaPath } = props
	const options = getIconLibraryOptions(payload.config, props.adapters).map((option) => ({
		label: resolveStaticLabel(option.label, i18n.language) ?? option.value,
		value: option.value,
	}))
	return (
		<IconLibrarySelect
			field={clientField}
			options={options}
			path={path}
			permissions={permissions}
			readOnly={readOnly}
			schemaPath={schemaPath}
		/>
	)
}
