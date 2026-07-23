import { applyRegistryConfig, type RegistryConfig } from '../plugin/applyRegistryConfig'
import type { AnyPollOptionSource } from './definePollOptionSource'

export type PollOptionSourceRegistry = Map<string, AnyPollOptionSource>

/** `false` removes a source, `true` keeps it (no-op: there are no built-ins), a definition adds or replaces one. */
export type PollOptionSourceOption = boolean | AnyPollOptionSource

export type PollOptionSourcesConfig = RegistryConfig<AnyPollOptionSource>

/**
 * Resolve the active poll option-source registry from a consumer map. Unlike the consent and
 * action registries there are no built-in defaults: the registry starts empty and only host
 * definitions populate it, so `true`/`false` entries are accepted but change nothing.
 */
export const resolvePollOptionSources = (
	config: PollOptionSourcesConfig = {}
): PollOptionSourceRegistry => applyRegistryConfig(new Map<string, AnyPollOptionSource>(), config)
