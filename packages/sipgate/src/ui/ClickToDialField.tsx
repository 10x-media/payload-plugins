import type { TextFieldServerComponent } from 'payload'
import { ClickToDialFieldClient } from './ClickToDialFieldClient'

const ClickToDialField: TextFieldServerComponent = ({ field, path, readOnly }) => {
	const label = typeof field.label === 'string' ? field.label : undefined
	const placeholder =
		typeof field.admin?.placeholder === 'string' ? field.admin.placeholder : undefined

	return (
		<ClickToDialFieldClient
			path={path ?? field.name}
			label={label}
			placeholder={placeholder}
			required={field.required}
			readOnly={readOnly}
		/>
	)
}

export default ClickToDialField
