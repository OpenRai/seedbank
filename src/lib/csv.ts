export function csvCell(value: string | number | bigint | boolean | null | undefined): string {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function downloadCsv(name: string, rows: Array<Array<string | number | bigint | boolean | null | undefined>>): void {
  const csv = `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}-${new Date().toISOString().replaceAll(':', '-')}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
