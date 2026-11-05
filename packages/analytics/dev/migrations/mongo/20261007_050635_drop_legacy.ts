import { dropLegacyNative } from '@10x-media/analytics/migrations'
import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

export async function up({ payload }: MigrateUpArgs): Promise<void> {
	await dropLegacyNative({ payload })
}

export async function down(_args: MigrateDownArgs): Promise<void> {
	// Nothing to restore: the dropped collections are not recreated.
}
