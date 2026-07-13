import type { CollectionConfig, Field } from 'payload'

/**
 * Instead of accepting a static field array (which deepMerge would silently replace), the consumer
 * receives the plugin's default fields and returns the final array. This makes the intent explicit:
 * append, prepend, filter out, or wrap any field without risk of accidentally wiping the defaults.
 */
export type FieldsOverride = (args: { defaultFields: Field[] }) => Field[]

/**
 * Typed override surface for plugin-managed collections. Top-level keys use explicit spread order
 * (see each collection builder) so the consumer always knows which values they can override and
 * which are locked by the plugin for correctness or security.
 */
export type CollectionOverrides = { fields?: FieldsOverride } & Partial<
	Omit<CollectionConfig, 'fields'>
>
