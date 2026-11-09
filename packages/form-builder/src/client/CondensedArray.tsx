'use client'

import {
	Button,
	CirclePlusIcon,
	FieldDescription,
	FieldLabel,
	LineIcon,
	RenderCustomComponent,
	RenderFields,
	useField,
	useForm,
} from '@payloadcms/ui'
import type { ArrayFieldClientProps } from 'payload'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import './admin.css'

const baseClass = 'fb-condensed-array'

/**
 * A custom `Field` for a real Payload `array` that renders its rows flat: each row is `[label, email]`
 * laid out at 50% width with a remove control, added by a footer button, and never wrapped in the
 * per-row `Collapsible` that Payload's native array applies unconditionally. Row ids and per-locale
 * storage stay Payload's: rows come from `useField({ hasRows: true })`, mutations go through
 * `useForm`'s `addFieldRow`/`removeFieldRow`, and each row's subfields render through `RenderFields`
 * at `{path}.{index}` exactly as the native array does, so localization, validation, and descriptions
 * work natively. Placed by {@link departmentsField}.
 */
export const CondensedArray = (props: ArrayFieldClientProps) => {
	const {
		field: { name, admin: { description } = {}, fields, label, localized },
		forceRender = false,
		path: pathFromProps,
		permissions,
		readOnly,
		schemaPath: schemaPathFromProps,
	} = props
	const schemaPath = schemaPathFromProps ?? name

	const { t } = useTranslation()
	const { addFieldRow, removeFieldRow } = useForm()
	const {
		customComponents: { Description, Label } = {},
		path,
		rows = [],
	} = useField<number>({ hasRows: true, potentiallyStalePath: pathFromProps })

	return (
		<div className={`field-type ${baseClass}`} id={`field-${path.replace(/\./g, '__')}`}>
			<RenderCustomComponent
				CustomComponent={Label}
				Fallback={<FieldLabel label={label} localized={localized} path={path} />}
			/>
			<RenderCustomComponent
				CustomComponent={Description}
				Fallback={<FieldDescription description={description} path={path} />}
			/>
			{rows.length > 0 ? (
				<div className={`${baseClass}__rows`}>
					{rows.map((row, index) => (
						<div key={row.id} className={`${baseClass}__row`}>
							<RenderFields
								className={`${baseClass}__fields`}
								fields={fields}
								forceRender={forceRender}
								parentIndexPath=""
								parentPath={`${path}.${index}`}
								parentSchemaPath={schemaPath}
								permissions={permissions === true ? permissions : (permissions?.fields ?? {})}
								readOnly={readOnly}
							/>
							{!readOnly ? (
								<div className={`${baseClass}__remove`}>
									<Button
										buttonStyle="ghost"
										icon={<LineIcon size={24} />}
										onClick={() => removeFieldRow({ path, rowIndex: index })}
										aria-label={t(keys.departmentRemoveRow)}
										margin={false}
									/>
								</div>
							) : null}
						</div>
					))}
				</div>
			) : null}
			{!readOnly ? (
				<div className={`${baseClass}__actions`}>
					<Button
						buttonStyle="ghost"
						icon={<CirclePlusIcon size={24} />}
						iconPosition="left"
						onClick={() => addFieldRow({ path, rowIndex: rows.length, schemaPath })}
						margin={false}
					>
						{t(keys.departmentAddRow)}
					</Button>
				</div>
			) : null}
		</div>
	)
}
