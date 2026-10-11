import type { ClientFieldWithOptionalType, ServerFieldBase } from 'payload'

/**
 * A field server component's props as its client component takes them: the server-only ones (the
 * request, form state, field config) stay behind.
 */
export const clientFieldProps = <
	F extends ClientFieldWithOptionalType,
	P extends Omit<ServerFieldBase, 'clientField'> & { clientField: F },
>(
	props: P
) => {
	const {
		clientField,
		clientFieldSchemaMap: _clientFieldSchemaMap,
		collectionSlug: _collectionSlug,
		data: _data,
		field: _field,
		fieldSchemaMap: _fieldSchemaMap,
		formState: _formState,
		i18n: _i18n,
		id: _id,
		operation: _operation,
		payload: _payload,
		preferences: _preferences,
		req: _req,
		siblingData: _siblingData,
		user: _user,
		value: _value,
		...client
	} = props
	return { ...client, field: clientField }
}
