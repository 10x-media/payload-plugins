/**
 * Helpers with no server and no React dependency: the guide target key formats. A host module
 * that both server code and client components import reads them from here; the root is the
 * server plugin and `./client` is a client entry.
 */
export {
	blockTargetKey,
	collectionTargetKey,
	customTargetKey,
	fieldTargetKey,
	globalTargetKey,
	targetFieldNameFor,
	targetKeysForDoc,
	type WikiTargetDoc,
	type WikiTargetType,
} from '../shared/targetKeys'
