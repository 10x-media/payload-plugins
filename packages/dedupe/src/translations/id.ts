import { keys, type TranslationKey } from './keys'

export const id: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Duplikat',
	[keys.queueTitle]: 'Duplikat',
	[keys.collection]: 'Koleksi',
	[keys.statusOpen]: 'Terbuka',
	[keys.statusDismissed]: 'Bukan duplikat',
	[keys.noPairs]: 'Tidak ada yang perlu ditinjau.',
	[keys.noCollections]: 'Tidak ada koleksi yang dikonfigurasi untuk pencarian duplikat.',
	[keys.dismiss]: 'Bukan duplikat',
	[keys.reopen]: 'Buka kembali',
	[keys.mergeInto]: 'Gabungkan ke {{title}}',
	[keys.runScan]: 'Pindai sekarang',
	[keys.scanQueued]: 'Pemindaian masuk antrean.',
	[keys.scanDone]: 'Pemindaian selesai: {{pairs}} pasangan terbuka dari {{compared}} perbandingan.',
	[keys.needsChoice]: 'Perlu pilihan',
	[keys.applied]: 'Digabungkan ke dokumen utama.',
	[keys.empty]: 'kosong',
	[keys.selectTwo]: 'Pilih 2 sampai {{max}} dokumen untuk digabungkan.',
	[keys.mergeSelected]: 'Gabungkan yang dipilih',
	[keys.noTransactions]:
		'Basis data ini tidak membuka transaksi. Jika penggabungan gagal sebelum dokumen utama ditulis, dokumen yang digabungkan mendapatkan kembali nilainya. Jika gagal setelahnya, dokumen utama menyimpan apa yang sudah ditulis dan dokumen yang digabungkan tetap ada, dengan nilai pengganti untuk nilai unik yang mereka lepaskan. Referensi yang dipindahkan aplikasi ke dokumen utama sebelum kegagalan tetap di sana. Penggabungan yang harus menghapus dokumen lebih dulu ditolak.',
	[keys.transactionsRequired]:
		'Penggabungan dimatikan: basis data ini tidak membuka transaksi, dan plugin diatur untuk mewajibkannya.',
	[keys.takenFrom]: 'Diambil dari {{title}}',
	[keys.error]: 'Terjadi kesalahan.',
	[keys.missingParams]: 'Layar penggabungan memerlukan satu koleksi dan dua ID dokumen.',
	[keys.confirmHeading]: 'Terapkan penggabungan ini?',
	[keys.confirmBody]: '{{absorbed}} akan digabungkan ke {{survivor}} dan keluar dari koleksi.',
	[keys.primary]: 'Utama · mempertahankan ID',
	[keys.makePrimary]: 'Jadikan utama',
	[keys.created]: 'Dibuat',
	[keys.updated]: 'Diperbarui',
	[keys.onlyDifferences]: 'Hanya perbedaan',
	[keys.showDiff]: 'Sorot perbedaan',
	[keys.mergeCount]: 'Gabungkan {{count}} dokumen',
	[keys.releaseMarked]:
		'{{title}} masuk ke tempat sampah dengan penanda di {{fields}}, karena {{survivor}} mengambil nilai tersebut dan hanya satu dokumen yang boleh memilikinya.',
	[keys.releaseEmptied]:
		'{{title}} masuk ke tempat sampah dengan {{fields}} dikosongkan, karena {{survivor}} mengambil nilai tersebut dan hanya satu dokumen yang boleh memilikinya.',
	[keys.pointersCleared]:
		'Tautan ke dokumen penggabungan ini dihapus dari {{fields}}: setelah penggabungan, tautan itu akan menunjuk ke dokumen yang sudah tidak ada atau ke {{survivor}} sendiri.',
	[keys.survivorDraft]:
		'{{title}} memiliki perubahan yang belum diterbitkan, yang akan diterbitkan oleh penggabungan. Terbitkan atau buang dulu.',
	[keys.mayNotApply]: 'Akses Anda tidak mengizinkan penggabungan ini diterapkan.',
	[keys.releaseDeletes]:
		'{{title}} akan dihapus, bukan dipindahkan ke tempat sampah, karena {{survivor}} mengambil {{fields}} miliknya dan hanya satu dokumen yang boleh memiliki nilai tersebut.',
	[keys.signals]: 'Mengapa mirip',
	[keys.takeAll]: 'Simpan semua nilai',
	[keys.similarity]: 'Kemiripan',
	[keys.whySame]: 'Sama: {{fields}}',
	[keys.whySimilar]: 'Mirip: {{fields}}',
	[keys.whyDiffer]: 'Berbeda: {{fields}}',
	[keys.whyVeto]: 'Dikecualikan oleh {{fields}}',
	[keys.markedBy]: 'Ditandai oleh',
	[keys.aboutOpen]:
		'Dokumen yang mirip, satu baris per grup, menunggu ditinjau. Buka salah satu untuk menggabungkannya atau menandainya bukan duplikat.',
	[keys.aboutDismissed]:
		'Dokumen yang ditandai bukan duplikat, satu baris per grup. Pemindaian berikutnya tetap menyimpannya di sini; buka salah satu untuk membukanya kembali.',
	[keys.markedNotDuplicates]: 'Ditandai bukan duplikat.',
	[keys.dismissedNote]: 'Ditandai bukan duplikat oleh {{user}} pada {{date}}.',
	[keys.markedApart]:
		'{{a}} dan {{b}} ditandai bukan duplikat oleh {{user}} pada {{date}}. Menggabungkannya mengabaikan tanda itu.',
	[keys.removeFromMerge]: 'Keluarkan dari penggabungan ini',
	[keys.removeHeading]: 'Keluarkan {{title}} dari penggabungan ini?',
	[keys.removeBody]:
		'Dokumennya sendiri tidak berubah. Nilai yang dipilih darinya di layar ini dibuang.',
	[keys.andMore]: '{{title}} dan {{count}} lainnya',
}
