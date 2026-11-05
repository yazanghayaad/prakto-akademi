// Which file formats FilePreview can show. Kept apart from the preview itself
// so MediaViewer can decide without loading the parsers.

export const TEXT_FORMATS = new Set(['txt', 'json', 'md', 'py', 'sql', 'xml', 'yaml', 'yml', 'log', 'r', 'js', 'ts'])

export const PREVIEW_FORMATS = new Set(['docx', 'xlsx', 'pptx', 'csv', 'ipynb', 'zip', ...TEXT_FORMATS])

export function canPreview(format?: string | null): boolean {
  return PREVIEW_FORMATS.has((format || '').toLowerCase().replace(/^\./, ''))
}
