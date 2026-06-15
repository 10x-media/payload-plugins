import { createServerFeature } from '@payloadcms/richtext-lexical'

export type FolderUploadOverrideClientProps = {
	allUploadSlugs: string[]
	folderEnabledSlugs: string[]
}

export const FolderUploadOverrideFeature = createServerFeature<
	undefined,
	undefined,
	FolderUploadOverrideClientProps
>({
	feature: ({ config }) => {
		const folderEnabledSlugs = config.collections.filter((c) => c.folders).map((c) => c.slug)

		const allUploadSlugs = config.collections.filter((c) => c.upload).map((c) => c.slug)

		return {
			ClientFeature: '@10xmedia/payload-folder-picker/client#FolderUploadOverrideFeatureClient',
			clientFeatureProps: { allUploadSlugs, folderEnabledSlugs },
		}
	},
	key: 'folderUploadOverride',
})
