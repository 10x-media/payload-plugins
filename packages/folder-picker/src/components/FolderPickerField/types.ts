// biome-ignore-all lint/suspicious/noExplicitAny: This is copied from the core Payload repo, 1:1
export type ValueAsDataWithRelation = {
	relationTo: string
	value: any
}

export type ReloadDoc = (doc: number | string, collectionSlug: string) => Promise<void>
