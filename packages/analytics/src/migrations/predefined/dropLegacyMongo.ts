/**
 * Migration a MongoDB install upgrading from 1.0.0-beta.11 or earlier creates with `--file
 * @10x-media/analytics/migrations/drop-legacy-mongo`; Payload writes these strings into the file.
 */
export const imports = "import { dropLegacyNative } from '@10x-media/analytics/migrations'"

export const upSQL = '  await dropLegacyNative({ payload })'

export const downSQL = '  // Nothing to restore: the dropped collections are not recreated.'
