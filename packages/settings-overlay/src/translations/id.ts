import { keys, type TranslationKey } from './keys'

export const id: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Panel Pengaturan',
	[keys.appearanceLabel]: 'Tampilan',
	[keys.back]: 'Kembali',
	[keys.close]: 'Tutup',
	[keys.delete]: 'Hapus',
	[keys.deleteBody]: 'Dokumen ini akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.',
	[keys.deleteConfirm]: 'Hapus',
	[keys.deleteHeading]: 'Hapus dokumen?',
	[keys.deleted]: 'Dokumen dihapus',
	[keys.discardBody]: 'Ada perubahan yang belum disimpan. Keluar sekarang akan membuangnya.',
	[keys.discardConfirm]: 'Buang perubahan',
	[keys.discardHeading]: 'Buang perubahan?',
	[keys.empty]: 'Belum ada yang bisa ditampilkan di sini.',
	[keys.loadFailed]: 'Gagal memuat. Silakan coba lagi.',
	[keys.noResults]: 'Tidak ada yang cocok.',
	[keys.searchPlaceholder]: 'Cari',
}
