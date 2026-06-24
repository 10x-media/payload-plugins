'use client'

const DATE_RANGE_CSS = `
@layer payload-default {
	.date-range-picker .react-datepicker__input-container input { cursor: pointer; }
	.date-range-calendar__header { position: relative; display: flex; align-items: center; justify-content: center; }
	.date-range-calendar__header .react-datepicker__navigation { position: absolute; top: 50%; transform: translateY(-50%); }
	.date-range-calendar__header .react-datepicker__navigation--previous { left: 0; }
	.date-range-calendar__header .react-datepicker__navigation--next { right: 0; }
	.date-range-calendar__month-label { padding: 10px 0; font-size: 0.8rem; height: 37px !important; display: flex; align-items: center; justify-content: center; font-family: var(--font-body) !important; color: var(--theme-elevation-1000); }
	.date-range-calendar .react-datepicker__day--in-range { background-color: var(--theme-elevation-150); color: var(--theme-elevation-1000); border-radius: 0; }
	.date-range-calendar .react-datepicker__day--in-selecting-range:not(.react-datepicker__day--range-start, .react-datepicker__day--range-end) { background-color: var(--theme-elevation-100); border-radius: 0; }
	.date-range-calendar .react-datepicker__day--range-start, .date-range-calendar .react-datepicker__day--range-end, .date-range-calendar .react-datepicker__day--selecting-range-start { background-color: var(--theme-elevation-800) !important; color: var(--theme-elevation-0) !important; font-weight: bold; border-radius: 0 !important; }
}
`

export function DateRangeStyles() {
	// biome-ignore lint/security/noDangerouslySetInnerHtml: static build-time CSS constant, no user input
	return <style dangerouslySetInnerHTML={{ __html: DATE_RANGE_CSS }} />
}
