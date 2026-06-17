import type { AnyConsentSource } from '../defineConsentSource'
import { pageReferenceSource } from './pageReference'
import { staticSource } from './static'

export const defaultConsentSources: Record<string, AnyConsentSource> = {
	static: staticSource as AnyConsentSource,
	pageReference: pageReferenceSource as AnyConsentSource,
}
