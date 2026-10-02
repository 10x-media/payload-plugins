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
	[keys.filterApi]: 'API',
	[keys.apiPlaceholder]: 'REST, GraphQL, local…',
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
	[keys.filterEvent]: 'Peristiwa',
	[keys.filterAll]: 'Semua',
	[keys.dateAnyTime]: 'Kapan saja',
	[keys.dateLast24h]: '24 jam terakhir',
	[keys.dateLast7d]: '7 hari terakhir',
	[keys.dateLast30d]: '30 hari terakhir',
	[keys.dateCustomRange]: 'Rentang khusus…',
	[keys.eventGroupWrites]: 'Perubahan',
	[keys.eventGroupAuth]: 'Autentikasi',
	[keys.eventGroupCustom]: 'Kustom',
	[keys.eventAllAuth]: 'Semua peristiwa autentikasi',
	[keys.eventAllCustom]: 'Semua peristiwa kustom',
	[keys.eventOther]: 'Jenis peristiwa lain…',
	[keys.moreFilters]: 'Filter lainnya',
	[keys.choose]: 'Pilih…',
	[keys.refPlaceholder]: 'Pilih, atau ketik ID',
	[keys.impersonated]: 'ditiru',
	[keys.impersonatedBy]: 'Ditiru oleh',
	[keys.deletedUser]: 'Pengguna dihapus',
	[keys.toggleDetails]: 'Tampilkan atau sembunyikan detail',
	[keys.sectionSnapshot]: 'Snapshot',
	[keys.sectionAuthEvent]: 'Peristiwa autentikasi',
	[keys.sectionCustomEvent]: 'Peristiwa khusus',
	[keys.viewGlobal]: 'Global',
	[keys.viewDocument]: 'Dokumen',
	[keys.fieldsChanged]: '{{count}} bidang',
	[keys.fieldsChangedPlural]: '{{count}} bidang',

	// Diff viewer
	[keys.diffPath]: 'Jalur',
	[keys.diffBefore]: 'Sebelum',
	[keys.diffAfter]: 'Sesudah',
	[keys.diffValue]: 'Nilai',
	[keys.rawJson]: 'JSON mentah',

	// Auth events
	[keys.authEventLogin]: 'Masuk',
	[keys.authEventForgotPassword]: 'Lupa kata sandi',
	[keys.authEventFailedLogin]: 'Gagal masuk',
}
