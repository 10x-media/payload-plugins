import type { Config, SanitizedConfig } from 'payload'

import type { ResolvedOptions } from '../types'
import { REGISTRY_KEY } from './constants'

export const setRegistry = (config: Config, resolved: ResolvedOptions): void => {
	config.custom ??= {}
	config.custom[REGISTRY_KEY] = resolved
}

export const getRegistry = (
	config: Pick<Config | SanitizedConfig, 'custom'>
): ResolvedOptions | undefined =>
	(config.custom as Record<string, ResolvedOptions | undefined> | undefined)?.[REGISTRY_KEY]
