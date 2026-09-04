import { keys, type TranslationKey } from './keys'

export const ar: Record<TranslationKey, string> = {
	[keys.undo]: 'تراجع',
	[keys.redo]: 'إعادة',
	[keys.debug]: 'سجل التراجع',
	[keys.debugTooltip]: 'فحص سجل التراجع',
	[keys.debugTitle]: 'سجل التراجع',
	[keys.debugEmpty]: 'لم يُسجَّل أي سجل بعد.',
	[keys.debugClose]: 'إغلاق',
	[keys.debugPending]: 'قيد الانتظار (غير مسجل)',
	[keys.debugOriginal]: 'الحالة الأصلية',
	[keys.debugCopy]: 'نسخ JSON',
}
