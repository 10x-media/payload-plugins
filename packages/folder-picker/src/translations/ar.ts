import { keys, type TranslationKey } from './keys'

export const ar: Record<TranslationKey, string> = {
	[keys.gridView]: 'العرض كشبكة',
	[keys.listView]: 'العرض كقائمة',
	[keys.orderLabel]: 'الاتجاه',
	[keys.pickManyHint]:
		'اضغط باستمرار على {{modifier}} لتحديد أكثر من عنصر، و{{range}} لتحديد نطاق.',
	[keys.pluginName]: 'اختيار المجلد',
	[keys.retry]: 'حاول مرة أخرى',
	[keys.sortByLabel]: 'الترتيب حسب',
}
