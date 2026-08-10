export const formatDatePill = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
    })
  } catch {
    return iso
  }
}
