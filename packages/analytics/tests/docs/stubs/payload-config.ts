import type { SanitizedConfig } from 'payload'

/** `@payload-config`, the alias a Next app points at its Payload config. */
declare const config: Promise<SanitizedConfig>
export default config
