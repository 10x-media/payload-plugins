/** Any registry entry: an object carrying a string `type` discriminator, keyed by that type. */
export type TypedDefinition = { type: string }

/** Per-type opt-in: `false` removes a type, `true` keeps the seeded default, a definition adds or replaces one. */
export type RegistryOption<T extends TypedDefinition> = boolean | T

export type RegistryConfig<T extends TypedDefinition> = Record<string, RegistryOption<T>>

/**
 * Apply a per-type opt-in override map onto a seeded registry, in place. `false` removes the type,
 * `true` keeps whatever default is already seeded (a no-op when none exists), and a definition adds
 * or replaces one with its `type` forced to the config key, so the authored slug (derived from
 * `type`) and the lookup key can never drift apart and silently orphan the entry. Shared by the
 * field-type, validation-rule, action, poll-source, and poll-type registries.
 */
export const applyRegistryConfig = <T extends TypedDefinition>(
	registry: Map<string, T>,
	config: RegistryConfig<T>
): Map<string, T> => {
	for (const [type, option] of Object.entries(config)) {
		if (option === false) {
			registry.delete(type)
		} else if (option !== true) {
			registry.set(type, { ...option, type })
		}
	}
	return registry
}
