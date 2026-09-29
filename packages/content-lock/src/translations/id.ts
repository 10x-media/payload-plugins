import { keys, type TranslationKey } from './keys'

/** Indonesian values, keyed by the typed constants in `keys.ts` (see `en.ts`). */
export const id: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Kunci Konten',
	[keys.collectionSingular]: 'Kunci konten',
	[keys.collectionPlural]: 'Kunci konten',

	[keys.fieldTitle]: 'Judul',
	[keys.fieldAnnounceAt]: 'Umumkan mulai',
	[keys.fieldAnnounceAtDescription]:
		'Kapan banner terjadwal mulai ditampilkan. Kosongkan jika tidak perlu diumumkan.',
	[keys.fieldStartsAt]: 'Mulai pada',
	[keys.fieldStartsAtDescription]: 'Kosongkan untuk langsung mengunci konten.',
	[keys.fieldEndAtTime]: 'Berakhir pada waktu tertentu',
	[keys.fieldEndsAt]: 'Berakhir pada',
	[keys.fieldEndedAt]: 'Diakhiri pada',
	[keys.fieldLockEverything]: 'Kunci semua',
	[keys.fieldLockEverythingDescription]: 'Nonaktifkan untuk mengunci konten terpilih saja.',
	[keys.fieldGroups]: 'Grup',
	[keys.fieldCollections]: 'Koleksi',
	[keys.fieldGlobals]: 'Global',
	[keys.fieldMessage]: 'Pesan',
	[keys.fieldAnnouncementMessageDescription]:
		'Ditampilkan selama penguncian diumumkan. Kosongkan untuk pemberitahuan bawaan.',
	[keys.fieldActiveMessageDescription]:
		'Ditampilkan selama penguncian aktif. Kosongkan untuk pemberitahuan bawaan.',
	[keys.tabAnnouncement]: 'Pengumuman',
	[keys.tabActive]: 'Selama penguncian',
	[keys.fieldStatus]: 'Status',
	[keys.statusDraft]: 'Draf',
	[keys.statusPending]: 'Menunggu',
	[keys.statusAnnounced]: 'Diumumkan',
	[keys.statusActive]: 'Aktif',
	[keys.statusEnded]: 'Berakhir',

	[keys.tokenPickDate]: 'Tanggal dan waktu',
	[keys.tokenFormat]: 'Format',
	[keys.tokenGroupLabel]: 'Detail penguncian',
	[keys.tokenRemove]: 'Hapus',
	[keys.tokenStartsOnPublish]: 'saat diterbitkan',
	[keys.tokenNoEnd]:
		'Penguncian ini diakhiri secara manual, jadi tidak ada akhir untuk ditampilkan.',
	[keys.tokenNoAnnouncement]: 'Penguncian ini tidak memiliki waktu pengumuman.',
	[keys.tokenNoScope]:
		'Penguncian ini mencakup semuanya, jadi tidak ada cakupan untuk dicantumkan.',
	[keys.tokenNoDate]: 'Pilih tanggal.',
	[keys.tokenStartsAt]: 'Awal penguncian',
	[keys.tokenEndsAt]: 'Akhir penguncian',
	[keys.tokenAnnounceAt]: 'Awal pengumuman',
	[keys.tokenDate]: 'Tanggal khusus',
	[keys.tokenScope]: 'Konten yang dikunci',
	[keys.formatDatetime]: 'Tanggal dan waktu',
	[keys.formatDate]: 'Tanggal',
	[keys.formatTime]: 'Waktu',
	[keys.formatRelative]: 'Relatif',

	[keys.errorAnnounceAfterStart]: 'Pengumuman harus dimulai sebelum penguncian.',
	[keys.errorEndBeforeStart]: 'Penguncian harus berakhir setelah dimulai.',
	[keys.errorEndsAtRequired]: 'Tentukan kapan penguncian berakhir.',
	[keys.errorTargetsRequired]: 'Pilih setidaknya satu item untuk dikunci.',
	[keys.errorEndedReadOnly]: 'Penguncian yang sudah berakhir tidak dapat diubah lagi.',
	[keys.errorActiveStartMoved]:
		'Penguncian aktif tidak dapat dipindahkan ke masa depan. Akhiri lalu jadwalkan yang baru.',
	[keys.errorLocked]: 'Konten dikunci karena pemeliharaan. Silakan coba lagi nanti.',

	[keys.bannerAnnouncedTitle]: 'Pemeliharaan terjadwal',
	[keys.bannerActiveTitle]: 'Pemeliharaan sedang berlangsung',
	[keys.bannerAnnouncedEverything]: 'Konten akan menjadi hanya-baca.',
	[keys.bannerActiveEverything]: 'Konten hanya-baca.',
	[keys.bannerAnnouncedPartial]: 'Akan menjadi hanya-baca: {{what}}.',
	[keys.bannerActivePartial]: 'Hanya-baca: {{what}}.',
	[keys.bannerFrom]: 'Dari',
	[keys.bannerUntil]: 'Hingga',
	[keys.bannerDismiss]: 'Tutup',
	[keys.bannerPrevious]: 'Pemberitahuan sebelumnya',
	[keys.bannerNext]: 'Pemberitahuan berikutnya',
	[keys.bannerPosition]: 'Pemberitahuan {{current}} dari {{total}}',

	[keys.actionLockNow]: 'Kunci sekarang',
	[keys.actionLockNowTitle]: 'Penguncian tak terjadwal',
	[keys.actionEndNow]: 'Akhiri sekarang',
	[keys.actionFailed]: 'Tidak dapat memperbarui penguncian.',
	[keys.confirmLockNowHeading]: 'Kunci semua konten sekarang?',
	[keys.confirmLockNowBody]:
		'Semua orang langsung kehilangan akses tulis hingga seseorang mengakhiri penguncian ini.',
	[keys.confirmEndNowHeading]: 'Akhiri penguncian ini sekarang?',
	[keys.confirmEndNowBody]: 'Konten yang tercakup penguncian ini langsung dapat diedit lagi.',
}
