import type { Field } from 'payload'

type PatchUploadFieldsOptions = {
	folderEnabledSlugs: Set<string>
}

const PICKER_COMPONENT_PATH = '@10x-media/folder-picker/client#FolderPickerField'

const isFieldHasComponent = (field: Field): boolean => {
	return Boolean(field.admin?.components?.Field)
}

export const patchUploadFields = (fields: Field[], options: PatchUploadFieldsOptions): Field[] => {
	const { folderEnabledSlugs } = options
	return fields.map((field) => {
		if (field.custom?.disableFolderPicker) {
			return field
		}

		if (field.type === 'upload' && !isFieldHasComponent(field)) {
			const enabledSlugs = Array.isArray(field.relationTo)
				? field.relationTo.filter((s) => folderEnabledSlugs.has(s))
				: folderEnabledSlugs.has(field.relationTo as string)
					? [field.relationTo as string]
					: []

			if (enabledSlugs.length > 0) {
				return {
					...field,
					admin: {
						...field.admin,
						components: {
							...field.admin?.components,
							Field: PICKER_COMPONENT_PATH,
						},
						custom: {
							...field.admin?.custom,
							folderEnabledRelations: enabledSlugs,
						},
					},
				} as Field
			}
		}

		if ('fields' in field && Array.isArray(field.fields)) {
			return { ...field, fields: patchUploadFields(field.fields, options) } as Field
		}

		if (field.type === 'tabs') {
			return {
				...field,
				tabs: field.tabs.map((tab) => ({
					...tab,
					fields: patchUploadFields(tab.fields, options),
				})),
			} as Field
		}

		if (field.type === 'blocks') {
			return {
				...field,
				blocks: field.blocks.map((block) => {
					if (block.custom?.disableFolderPicker) {
						return block
					}
					return {
						...block,
						fields: patchUploadFields(block.fields, options),
					}
				}),
			} as Field
		}

		return field as Field
	})
}
