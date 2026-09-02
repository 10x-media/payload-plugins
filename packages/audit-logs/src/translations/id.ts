import { keys, type TranslationKey } from './keys'

export const id: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Log Audit',
	// View header
	[keys.title]: 'Log Audit',
	[keys.entries]: '{{count}} entri',

	// Breadcrumb / step nav
	[keys.breadcrumb]: 'Log audit',

	// Access messages (server-rendered)
	[keys.selectTenant]: 'Pilih tenant untuk melihat log audit.',

	// Empty state
	[keys.noEntries]: 'Tidak ada entri log audit.',

	// Pagination
	[keys.paginationInfo]: '{{from}}–{{to}} dari {{total}}',

	// Debug bar
	[keys.debug]: 'Debug',
	[keys.queuing]: 'Mengantre…',
	[keys.runArchive]: 'Jalankan pengarsipan',
	[keys.runDelete]: 'Jalankan penghapusan',

	// Filter bar
	[keys.filterCollection]: 'Koleksi',
	[keys.filterGlobal]: 'Global',
	[keys.filterOperation]: 'Operasi',
	[keys.filterTenant]: 'Tenant',
	[keys.filterUser]: 'Pengguna',
	[keys.filterDocument]: 'Dokumen',
	[keys.filterEventType]: 'Jenis peristiwa',
	[keys.filterChangedPath]: 'Jalur yang diubah',
	[keys.filterGroup]: 'Grup',
	[keys.groupFilterBtn]: 'Filter menurut grup',
	[keys.filterDate]: 'Tanggal',
	[keys.filterDateRange]: 'Rentang tanggal',
	[keys.addFilter]: '+ Tambah filter',
	[keys.apply]: 'Terapkan',
	[keys.clearAll]: 'Hapus semua',

	// Editors shared
	[keys.selectPlaceholder]: '— Pilih —',
	[keys.done]: 'Selesai',

	// Date range editor
	[keys.dateFrom]: 'Dari',
	[keys.dateTo]: 'Sampai',
	[keys.startDate]: 'Tanggal mulai…',
	[keys.endDate]: 'Tanggal akhir…',

	// Single value editor
	[keys.groupPlaceholder]: 'ID grup…',
	[keys.orEnterId]: 'atau masukkan ID secara manual',
	[keys.selectCollectionHint]: 'Pilih filter koleksi untuk mengaktifkan pencarian',
	[keys.documentIdPlaceholder]: 'ID dokumen…',
	[keys.update]: 'Perbarui',
	[keys.add]: 'Tambah',
	[keys.selectEventPlaceholder]: '— Pilih peristiwa —',
	[keys.eventTypePlaceholder]: 'Jenis peristiwa…',
	[keys.fieldPathPlaceholder]: 'Jalur bidang…',

	// User filter editor
	[keys.selectCollectionPlaceholder]: 'Pilih koleksi…',
	[keys.userIdPlaceholder]: 'ID pengguna…',

	// Doc select
	[keys.searchPlaceholder]: 'Cari…',

	// Log row
	[keys.metaIp]: 'IP',
	[keys.metaUa]: 'UA',
	[keys.metaLocale]: 'Bahasa',
	[keys.sectionSnapshot]: 'Snapshot',
	[keys.sectionAuthEvent]: 'Peristiwa autentikasi',
	[keys.sectionCustomEvent]: 'Peristiwa khusus',
	[keys.viewGlobal]: 'Lihat global →',
	[keys.viewDocument]: 'Lihat dokumen →',
	[keys.fieldsChanged]: '{{count}} bidang',
	[keys.fieldsChangedPlural]: '{{count}} bidang',

	// Diff viewer
	[keys.diffPath]: 'Jalur',
	[keys.diffBefore]: 'Sebelum',
	[keys.diffAfter]: 'Sesudah',

	// Auth events
	[keys.authEventLogin]: 'Masuk',
	[keys.authEventForgotPassword]: 'Lupa kata sandi',
	[keys.authEventFailedLogin]: 'Gagal masuk',
}
