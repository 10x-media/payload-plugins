import { keys, type TranslationKey } from './keys'

export const ar: Record<TranslationKey, string> = {
	[keys.pluginName]: 'التكرارات',
	[keys.queueTitle]: 'المستندات المكررة',
	[keys.collection]: 'المجموعة',
	[keys.statusOpen]: 'مفتوحة',
	[keys.statusDismissed]: 'ليست تكرارات',
	[keys.noPairs]: 'لا يوجد ما يستوجب المراجعة.',
	[keys.noCollections]: 'لم يتم إعداد أي مجموعة للبحث عن التكرارات.',
	[keys.dismiss]: 'ليست مكررة',
	[keys.reopen]: 'إعادة فتح',
	[keys.mergeInto]: 'دمج في {{title}}',
	[keys.runScan]: 'فحص الآن',
	[keys.scanQueued]: 'تمت إضافة الفحص إلى قائمة الانتظار.',
	[keys.scanDone]: 'انتهى الفحص: {{pairs}} أزواج مفتوحة من {{compared}} مقارنة.',
	[keys.needsChoice]: 'يتطلب اختيارًا',
	[keys.applied]: 'تم الدمج في المستند الأساسي.',
	[keys.empty]: 'فارغ',
	[keys.backToQueue]: 'العودة إلى التكرارات',
	[keys.selectTwo]: 'اختر من 2 إلى {{max}} مستندات للدمج.',
	[keys.mergeSelected]: 'دمج المحدد',
	[keys.noTransactions]:
		'قاعدة البيانات هذه لا تفتح معاملات. إذا فشل الدمج في منتصفه تبقى الخطوات المنجزة: قيم مؤقتة في المستندات المدمجة، ومراجع منقولة، وبعض لغات المستند الأساسي. يُعلَّم سجل الدمج بالفشل ويسرد ما نُقل.',
	[keys.transactionsRequired]:
		'الدمج متوقف: قاعدة البيانات هذه لا تفتح معاملات، والإضافة مضبوطة على اشتراطها.',
	[keys.takenFrom]: 'مأخوذ من {{title}}',
	[keys.error]: 'حدث خطأ ما.',
	[keys.missingParams]: 'تحتاج شاشة الدمج إلى مجموعة ومعرّفي مستندين.',
	[keys.confirmHeading]: 'تطبيق هذا الدمج؟',
	[keys.confirmBody]: 'سيتم دمج {{absorbed}} في {{survivor}} وإزالته من المجموعة.',
	[keys.primary]: 'الأساسي · يحتفظ بمعرّفه',
	[keys.makePrimary]: 'اجعله أساسيًا',
	[keys.created]: 'أُنشئ',
	[keys.updated]: 'عُدّل',
	[keys.onlyDifferences]: 'الاختلافات فقط',
	[keys.showDiff]: 'تمييز الاختلافات',
	[keys.mergeCount]: 'دمج {{count}} مستندات',
	[keys.releaseMarked]:
		'سينتقل {{title}} إلى سلة المهملات مع علامة في {{fields}}، لأن {{survivor}} يأخذ هذه القيم ولا يجوز أن يحملها إلا مستند واحد.',
	[keys.releaseEmptied]:
		'سينتقل {{title}} إلى سلة المهملات مع ترك {{fields}} فارغًا، لأن {{survivor}} يأخذ هذه القيم ولا يجوز أن يحملها إلا مستند واحد.',
	[keys.pointersCleared]:
		'تُزال الإشارات إلى مستندات هذا الدمج من {{fields}}: بعد الدمج ستشير إلى مستند لم يعد موجودًا أو إلى {{survivor}} نفسه.',
	[keys.survivorDraft]: 'لدى {{title}} تغييرات غير منشورة سينشرها الدمج. انشرها أو تجاهلها أولًا.',
	[keys.mayNotApply]: 'صلاحياتك لا تسمح بتطبيق هذا الدمج.',
	[keys.releaseDeletes]:
		'سيُحذف {{title}} بدلًا من نقله إلى سلة المهملات، لأن {{survivor}} يأخذ {{fields}} ولا يجوز أن يحمل هذه القيم إلا مستند واحد.',
	[keys.signals]: 'سبب التشابه',
	[keys.takeAll]: 'الاحتفاظ بجميع القيم',
	[keys.similarity]: 'التشابه',
	[keys.whySame]: 'متطابق: {{fields}}',
	[keys.whySimilar]: 'متشابه: {{fields}}',
	[keys.whyDiffer]: 'مختلف: {{fields}}',
	[keys.whyVeto]: 'مستبعد بسبب {{fields}}',
	[keys.markedBy]: 'علّمه',
	[keys.aboutOpen]:
		'مستندات متشابهة، صف لكل مجموعة، بانتظار المراجعة. افتح صفًا لدمج المجموعة أو وسمها بأنها ليست مكررة.',
	[keys.aboutDismissed]:
		'مستندات موسومة بأنها ليست مكررة، صف لكل مجموعة. تبقيها عمليات الفحص اللاحقة هنا؛ افتح صفًا لإعادة فتحها.',
	[keys.markedNotDuplicates]: 'عُلّمت بأنها ليست مكررة.',
	[keys.dismissedNote]: 'علّمها {{user}} بأنها ليست مكررة في {{date}}.',
	[keys.markedApart]:
		'علّم {{user}} {{a}} و{{b}} بأنهما ليسا مكررين في {{date}}. يلغي الدمج هذا التعليم.',
	[keys.removeFromMerge]: 'إزالة من هذا الدمج',
	[keys.removeHeading]: 'إزالة {{title}} من هذا الدمج؟',
	[keys.removeBody]: 'لا يتغير المستند نفسه. تُلغى القيم المختارة منه في هذه الشاشة.',
	[keys.andMore]: '{{title}} و{{count}} أخرى',
}
