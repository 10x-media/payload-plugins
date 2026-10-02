import { keys, type TranslationKey } from './keys'

export const ar: Record<TranslationKey, string> = {
	[keys.pluginName]: 'سجلات التدقيق',
	// View header
	[keys.title]: 'سجلات التدقيق',
	[keys.entries]: '{{count}} إدخالات',

	// Breadcrumb / step nav
	[keys.breadcrumb]: 'سجلات التدقيق',

	// Access messages (server-rendered)
	[keys.selectTenant]: 'اختر مستأجرًا لعرض سجلات التدقيق.',

	// Empty state
	[keys.noEntries]: 'لم يتم العثور على إدخالات في سجل التدقيق.',

	// Pagination
	[keys.paginationInfo]: '{{from}}–{{to}} من {{total}}',

	// Debug bar
	[keys.debug]: 'تصحيح الأخطاء',
	[keys.queuing]: 'جارٍ الإضافة إلى قائمة الانتظار…',
	[keys.runArchive]: 'تشغيل الأرشفة',
	[keys.runDelete]: 'تشغيل الحذف',

	// Filter bar
	[keys.filterCollection]: 'المجموعة',
	[keys.filterGlobal]: 'عام',
	[keys.filterOperation]: 'العملية',
	[keys.filterTenant]: 'المستأجر',
	[keys.filterUser]: 'المستخدم',
	[keys.filterDocument]: 'المستند',
	[keys.filterEventType]: 'نوع الحدث',
	[keys.filterChangedPath]: 'المسار المتغير',
	[keys.filterGroup]: 'التجميع',
	[keys.groupFilterBtn]: 'تصفية حسب التجميع',
	[keys.filterDate]: 'التاريخ',
	[keys.filterDateRange]: 'النطاق الزمني',
	[keys.addFilter]: '+ إضافة عامل تصفية',
	[keys.apply]: 'تطبيق',
	[keys.clearAll]: 'مسح الكل',

	// Editors shared
	[keys.selectPlaceholder]: '— اختر —',
	[keys.done]: 'تم',

	// Date range editor
	[keys.dateFrom]: 'من',
	[keys.dateTo]: 'إلى',
	[keys.startDate]: 'تاريخ البدء…',
	[keys.endDate]: 'تاريخ الانتهاء…',

	// Single value editor
	[keys.groupPlaceholder]: 'معرّف التجميع…',
	[keys.orEnterId]: 'أو أدخل المعرّف يدويًا',
	[keys.selectCollectionHint]: 'اختر عامل تصفية المجموعة لتفعيل البحث',
	[keys.documentIdPlaceholder]: 'معرّف المستند…',
	[keys.update]: 'تحديث',
	[keys.add]: 'إضافة',
	[keys.selectEventPlaceholder]: '— اختر حدثًا —',
	[keys.eventTypePlaceholder]: 'نوع الحدث…',
	[keys.fieldPathPlaceholder]: 'مسار الحقل…',

	// User filter editor
	[keys.selectCollectionPlaceholder]: 'اختر مجموعة…',
	[keys.userIdPlaceholder]: 'معرّف المستخدم…',

	// Doc select
	[keys.searchPlaceholder]: 'بحث…',

	// Log row
	[keys.metaIp]: 'IP',
	[keys.metaUa]: 'UA',
	[keys.metaLocale]: 'اللغة',
	[keys.filterEvent]: 'الحدث',
	[keys.filterAll]: 'الكل',
	[keys.dateAnyTime]: 'أي وقت',
	[keys.dateLast24h]: 'آخر 24 ساعة',
	[keys.dateLast7d]: 'آخر 7 أيام',
	[keys.dateLast30d]: 'آخر 30 يومًا',
	[keys.dateCustomRange]: 'نطاق مخصص…',
	[keys.eventGroupWrites]: 'التغييرات',
	[keys.eventGroupAuth]: 'المصادقة',
	[keys.eventGroupCustom]: 'مخصص',
	[keys.eventAllAuth]: 'كل أحداث المصادقة',
	[keys.eventAllCustom]: 'كل الأحداث المخصصة',
	[keys.eventOther]: 'نوع حدث آخر…',
	[keys.moreFilters]: 'مزيد من عوامل التصفية',
	[keys.choose]: 'اختر…',
	[keys.refPlaceholder]: 'اختر أو اكتب معرّفًا',
	[keys.impersonated]: 'منتحَل',
	[keys.impersonatedBy]: 'انتحل الهوية',
	[keys.deletedUser]: 'مستخدم محذوف',
	[keys.toggleDetails]: 'إظهار التفاصيل أو إخفاؤها',
	[keys.sectionSnapshot]: 'لقطة',
	[keys.sectionAuthEvent]: 'حدث المصادقة',
	[keys.sectionCustomEvent]: 'حدث مخصص',
	[keys.viewGlobal]: 'عام',
	[keys.viewDocument]: 'المستند',
	[keys.fieldsChanged]: '{{count}} حقل',
	[keys.fieldsChangedPlural]: '{{count}} حقول',

	// Diff viewer
	[keys.diffPath]: 'المسار',
	[keys.diffBefore]: 'قبل',
	[keys.diffAfter]: 'بعد',

	// Auth events
	[keys.authEventLogin]: 'تسجيل الدخول',
	[keys.authEventForgotPassword]: 'نسيان كلمة المرور',
	[keys.authEventFailedLogin]: 'فشل تسجيل الدخول',
}
