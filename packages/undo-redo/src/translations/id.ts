import { keys, type TranslationKey } from './keys'

export const id: Record<TranslationKey, string> = {
	[keys.undo]: 'Urungkan',
	[keys.redo]: 'Ulangi',
	[keys.debug]: 'Riwayat urungkan',
	[keys.debugTooltip]: 'Periksa riwayat urungkan',
	[keys.debugTitle]: 'Riwayat urungkan',
	[keys.debugEmpty]: 'Belum ada riwayat yang direkam.',
	[keys.debugClose]: 'Tutup',
	[keys.debugPending]: 'Tertunda (belum direkam)',
	[keys.debugOriginal]: 'Kondisi awal',
	[keys.debugCopy]: 'Salin JSON',
}
