'use client'

// In-app previews for Library files the browser cannot render itself:
// Word, Excel, PowerPoint, CSV, text, Jupyter notebooks and zip archives.
// Everything is parsed client-side from the file's bytes (see ooxml.ts).

import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import { Download, FileArchive, Loader2 } from 'lucide-react'
import { formatFileSize } from '@/lib/media/mediaKind'
import { canPreview, TEXT_FORMATS } from './formats'
import {
  decodeText,
  imageMime,
  listZip,
  parseCsv,
  parseDocx,
  parseNotebook,
  parsePptx,
  parseXlsx,
  type DocBlock,
  type DocRun,
  type SlideShape,
  type ZipEntry,
} from './ooxml'

function extOf(name: string) {
  return (name.split('.').pop() || '').toLowerCase()
}

/** Fetches the file (with the session cookie) and renders a preview for `format`. */
export default function FilePreview({ url, format, name, maxHeightClass = 'max-h-[70vh]' }: {
  url: string
  format: string
  name: string
  maxHeightClass?: string
}) {
  const { t } = useTranslation()
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setBytes(null)
    setError(null)
    fetch(url, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then((buf) => !cancelled && setBytes(new Uint8Array(buf)))
      .catch((e) => !cancelled && setError(String(e?.message || e)))
    return () => {
      cancelled = true
    }
  }, [url])

  if (error) return <Notice text={`${t('media.preview.failed')} (${error})`} />
  if (!bytes) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
        <Loader2 size={16} className="animate-spin" /> {t('media.preview.loading')}
      </div>
    )
  }
  return (
    <div className={`overflow-auto rounded-xl border border-gray-200 bg-gray-50 ${maxHeightClass}`}>
      <PreviewBytes bytes={bytes} format={format.toLowerCase().replace(/^\./, '')} name={name} />
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return <div className="px-6 py-12 text-center text-sm text-gray-500">{text}</div>
}

/** Renders already-loaded bytes; also used for files inside a zip. */
function PreviewBytes({ bytes, format, name }: { bytes: Uint8Array; format: string; name: string }) {
  const { t } = useTranslation()
  try {
    if (!bytes.length) return <Notice text={t('media.preview.empty')} />
    switch (format) {
      case 'docx':
        return <DocxView bytes={bytes} />
      case 'xlsx':
        return <XlsxView bytes={bytes} />
      case 'pptx':
        return <PptxView bytes={bytes} />
      case 'csv':
        return <CsvView bytes={bytes} />
      case 'ipynb':
        return <NotebookView bytes={bytes} />
      case 'zip':
        return <ZipView bytes={bytes} name={name} />
      default:
        if (TEXT_FORMATS.has(format)) return <TextView bytes={bytes} />
        if (imageMime(`x.${format}`)) return <ImageView bytes={bytes} format={format} name={name} />
        return <Notice text={t('media.preview.no_preview')} />
    }
  } catch (e: any) {
    return <Notice text={`${t('media.preview.failed')} (${e?.message || e})`} />
  }
}

/** Object URLs created while parsing, revoked when the preview goes away. */
function useParsed<T>(parse: (urls: string[]) => T, deps: unknown[]): T {
  const urls = useMemo<string[]>(() => [], deps) // eslint-disable-line react-hooks/exhaustive-deps
  const value = useMemo(() => parse(urls), deps) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])
  return value
}

// ── Tables (CSV, Excel) ──────────────────────────────────────────────────────
function DataTable({ rows, header = true }: { rows: string[][]; header?: boolean }) {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0)
  const [head, ...body] = header ? rows : [[], ...rows]
  return (
    <table className="min-w-full border-collapse bg-white text-xs">
      {header && (
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="border-b border-gray-200 bg-gray-100 px-2 py-1.5 text-end text-gray-400 font-normal">#</th>
            {Array.from({ length: width }, (_, i) => (
              <th key={i} className="border-b border-s border-gray-200 bg-gray-100 px-3 py-1.5 text-start font-semibold text-gray-800 whitespace-nowrap">
                {head[i] ?? ''}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {body.map((r, ri) => (
          <tr key={ri} className="hover:bg-gray-50">
            <td className="border-b border-gray-100 px-2 py-1 text-end text-gray-400">{ri + (header ? 2 : 1)}</td>
            {Array.from({ length: width }, (_, i) => (
              <td key={i} className="border-b border-s border-gray-100 px-3 py-1 text-gray-700 whitespace-nowrap max-w-[320px] truncate">
                {r[i] ?? ''}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function RowCount({ shown, total }: { shown: number; total: number }) {
  const { t } = useTranslation()
  if (total <= shown) return null
  return (
    <div className="sticky inset-s-0 px-3 py-2 text-xs text-gray-500">
      {t('media.preview.showing_rows', { shown, total })}
    </div>
  )
}

function CsvView({ bytes }: { bytes: Uint8Array }) {
  const { rows, totalRows } = useMemo(() => parseCsv(decodeText(bytes)), [bytes])
  return (
    <div>
      <DataTable rows={rows} />
      <RowCount shown={rows.length} total={totalRows} />
    </div>
  )
}

function XlsxView({ bytes }: { bytes: Uint8Array }) {
  const sheets = useMemo(() => parseXlsx(bytes), [bytes])
  const [active, setActive] = useState(0)
  const sheet = sheets[active]
  return (
    <div>
      {sheets.length > 1 && (
        <div className="sticky top-0 z-20 flex gap-1 overflow-x-auto border-b border-gray-200 bg-white px-2 pt-2">
          {sheets.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              className={`whitespace-nowrap rounded-t-md px-3 py-1.5 text-xs font-medium ${i === active ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-800'}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {sheet && sheet.rows.length ? (
        <>
          <DataTable rows={sheet.rows} header={false} />
          <RowCount shown={sheet.rows.length} total={sheet.totalRows} />
        </>
      ) : (
        <Notice text="—" />
      )}
    </div>
  )
}

// ── Word ──────────────────────────────────────────────────────────────────────
function Runs({ runs }: { runs: DocRun[] }) {
  return (
    <>
      {runs.map((r, i) => {
        if (r.br) return <br key={i} />
        if (r.image) return <img key={i} src={r.image} alt="" className="my-2 inline-block max-w-full" />
        const style: React.CSSProperties = {
          fontWeight: r.bold ? 600 : undefined,
          fontStyle: r.italic ? 'italic' : undefined,
          textDecoration: r.underline ? 'underline' : undefined,
          whiteSpace: r.text === '\t' ? 'pre' : undefined,
        }
        return <span key={i} style={style}>{r.text}</span>
      })}
    </>
  )
}

function DocBlocks({ blocks }: { blocks: DocBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === 'table') {
          return (
            <table key={i} className="my-3 w-full border-collapse text-sm">
              <tbody>
                {b.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="border border-gray-300 px-2 py-1.5 align-top">
                        <DocBlocks blocks={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
        const empty = !b.runs.some((r) => r.text.trim() || r.image)
        if (empty) return <div key={i} className="h-3" />
        const cls = {
          title: 'text-2xl font-semibold mt-2 mb-3',
          h1: 'text-xl font-semibold mt-5 mb-2',
          h2: 'text-lg font-semibold mt-4 mb-2',
          h3: 'text-base font-semibold mt-3 mb-1',
          li: 'ms-5 list-item list-disc my-0.5',
          p: 'my-1.5',
        }[b.style]
        return <div key={i} className={cls}><Runs runs={b.runs} /></div>
      })}
    </>
  )
}

function DocxView({ bytes }: { bytes: Uint8Array }) {
  const blocks = useParsed((urls) => parseDocx(bytes, urls), [bytes])
  return (
    <div className="flex justify-center p-4 sm:p-6">
      <div className="w-full max-w-3xl rounded-md bg-white px-8 py-10 text-[15px] leading-relaxed text-gray-900 shadow-sm">
        <DocBlocks blocks={blocks} />
      </div>
    </div>
  )
}

// ── PowerPoint ────────────────────────────────────────────────────────────────
const EMU_PER_PX = 9525

function PptxView({ bytes }: { bytes: Uint8Array }) {
  const { t } = useTranslation()
  const deck = useParsed((urls) => parsePptx(bytes, urls), [bytes])
  const pct = (v: number, total: number) => `${(v / total) * 100}%`
  // Font sizes in container-width units so slides scale with the viewer.
  const cqw = (pt: number) => `${((pt * 96) / 72 / (deck.width / EMU_PER_PX)) * 100}cqw`

  const shape = (s: SlideShape, i: number) => {
    const box: React.CSSProperties = {
      position: 'absolute',
      left: pct(s.x, deck.width),
      top: pct(s.y, deck.height),
      width: pct(s.w, deck.width),
      height: pct(s.h, deck.height),
    }
    if (s.kind === 'image') return <img key={i} src={s.url} alt="" style={{ ...box, objectFit: 'contain' }} />
    if (s.kind === 'table') {
      return (
        <div key={i} style={box} className="overflow-hidden">
          <table className="h-full w-full border-collapse" style={{ fontSize: cqw(12) }}>
            <tbody>
              {s.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="border border-gray-300 px-[0.5cqw] align-top">{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    const justify = s.anchor === 'ctr' ? 'center' : s.anchor === 'b' ? 'flex-end' : 'flex-start'
    return (
      <div
        key={i}
        style={{ ...box, background: s.fill, display: 'flex', flexDirection: 'column', justifyContent: justify, padding: '0.6cqw 0.9cqw' }}
        className="overflow-hidden"
      >
        {s.paras.map((p, pi) => {
          const align = p.align === 'ctr' ? 'center' : p.align === 'r' ? 'right' : p.align === 'just' ? 'justify' : 'left'
          const hasText = p.runs.some((r) => r.text.trim())
          const basePt = s.isTitle ? 30 : 16
          return (
            <div
              key={pi}
              style={{
                textAlign: align as any,
                paddingInlineStart: `${p.level * 2 + (p.bullet && hasText ? 1.5 : 0)}cqw`,
                textIndent: p.bullet && hasText ? '-1.5cqw' : undefined,
                lineHeight: 1.2,
                minHeight: hasText ? undefined : cqw(basePt * 0.6),
              }}
            >
              {p.bullet && hasText && <span style={{ fontSize: cqw(basePt) }}>•&nbsp;</span>}
              {p.runs.map((r, ri) => (
                <span
                  key={ri}
                  style={{
                    fontSize: cqw(r.sizePt || basePt),
                    fontWeight: r.bold || s.isTitle ? 600 : 400,
                    fontStyle: r.italic ? 'italic' : undefined,
                    color: r.color || '#111827',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {r.text}
                </span>
              ))}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-5 p-4 sm:p-6">
      {deck.slides.map((slide) => (
        <figure key={slide.index} className="mx-auto max-w-4xl">
          <div
            className="relative w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
            style={{ aspectRatio: `${deck.width} / ${deck.height}`, containerType: 'inline-size' } as React.CSSProperties}
          >
            {slide.shapes.map(shape)}
          </div>
          <figcaption className="mt-1.5 text-center text-xs text-gray-400">
            {t('media.preview.slide', { n: slide.index, total: deck.slides.length })}
          </figcaption>
        </figure>
      ))}
    </div>
  )
}

// ── Text, notebooks, images ──────────────────────────────────────────────────
function TextView({ bytes }: { bytes: Uint8Array }) {
  const text = useMemo(() => {
    const raw = decodeText(bytes.subarray(0, 400_000))
    try {
      return JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
      return raw
    }
  }, [bytes])
  return <pre className="whitespace-pre-wrap wrap-break-word bg-white p-5 font-mono text-xs leading-relaxed text-gray-800">{text}</pre>
}

function NotebookView({ bytes }: { bytes: Uint8Array }) {
  const cells = useMemo(() => parseNotebook(decodeText(bytes)), [bytes])
  return (
    <div className="mx-auto max-w-4xl space-y-3 bg-white p-5">
      {cells.map((c, i) =>
        c.type === 'markdown' ? (
          <div key={i} className="prose prose-sm max-w-none text-gray-800">
            <ReactMarkdown>{c.source.replace(/<[^>]+>/g, '')}</ReactMarkdown>
          </div>
        ) : (
          <div key={i} className="flex gap-3">
            <div className="w-12 shrink-0 pt-2 text-end font-mono text-[11px] text-gray-400">
              {c.type === 'code' ? `[${c.count ?? ' '}]` : ''}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <pre className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-800">{c.source}</pre>
              {c.outputs.map((o, oi) =>
                o.image ? (
                  <img key={oi} src={o.image} alt="" className="max-w-full" />
                ) : o.text ? (
                  <pre key={oi} className="overflow-x-auto p-2 font-mono text-xs text-gray-600">{o.text}</pre>
                ) : null
              )}
            </div>
          </div>
        )
      )}
    </div>
  )
}

function ImageView({ bytes, format, name }: { bytes: Uint8Array; format: string; name: string }) {
  const url = useParsed(
    (urls) => {
      const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: imageMime(`x.${format}`) || 'image/png' }))
      urls.push(u)
      return u
    },
    [bytes, format]
  )
  return (
    <div className="flex items-center justify-center bg-white p-4">
      <img src={url} alt={name} className="max-h-[60vh] max-w-full object-contain" />
    </div>
  )
}

// ── Zip ───────────────────────────────────────────────────────────────────────
function ZipView({ bytes, name }: { bytes: Uint8Array; name: string }) {
  const { t } = useTranslation()
  const entries = useMemo(() => listZip(bytes), [bytes])
  // Single-file zips (the importer's wrapper for types the Library refuses) open directly.
  const [selected, setSelected] = useState<ZipEntry | null>(entries.length === 1 ? entries[0] : null)
  const download = (e: ZipEntry) => {
    const url = URL.createObjectURL(new Blob([e.data as BlobPart]))
    const a = document.createElement('a')
    a.href = url
    a.download = e.path.split('/').pop() || 'file'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <div>
      <div className="bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
          <FileArchive size={14} /> {name} · {t('media.preview.files', { count: entries.length })}
        </div>
        <ul className="divide-y divide-gray-100">
          {entries.map((e) => (
            <li
              key={e.path}
              className={`flex items-center gap-3 px-4 py-2 text-sm ${selected?.path === e.path ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
            >
              <button
                type="button"
                disabled={!canPreview(extOf(e.path)) && !imageMime(e.path)}
                onClick={() => setSelected(selected?.path === e.path ? null : e)}
                className="min-w-0 flex-1 truncate text-start text-gray-800 disabled:cursor-default disabled:text-gray-500"
              >
                {e.path}
              </button>
              <span className="shrink-0 text-xs text-gray-400">{formatFileSize(e.size)}</span>
              <button
                type="button"
                onClick={() => download(e)}
                title={t('media.download')}
                className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-800"
              >
                <Download size={14} />
              </button>
            </li>
          ))}
        </ul>
      </div>
      {selected && (
        <div className="border-t border-gray-200">
          <PreviewBytes bytes={selected.data} format={extOf(selected.path)} name={selected.path} />
        </div>
      )}
    </div>
  )
}
