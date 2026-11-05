import type { CollectionConfig, Field } from 'payload'

const nobody = (): boolean => false

/**
 * A collection only the engine writes, keyed by a text id it picks rather than a sequence: no
 * access, REST, GraphQL, admin view, timestamps or document locking for anyone.
 */
export const storeCollection = (args: {
	slug: string
	fields: Field[]
	indexes: NonNullable<CollectionConfig['indexes']>
}): CollectionConfig => ({
	slug: args.slug,
	admin: { hidden: true },
	access: { read: nobody, create: nobody, update: nobody, delete: nobody },
	endpoints: false,
	graphQL: false,
	timestamps: false,
	lockDocuments: false,
	fields: [{ name: 'id', type: 'text' }, ...args.fields],
	indexes: args.indexes,
})
