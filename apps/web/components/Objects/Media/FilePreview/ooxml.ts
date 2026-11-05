// Parsers for in-browser file previews: Office Open XML (docx, xlsx, pptx),
// CSV, Jupyter notebooks and zip listings. Pure functions over bytes; the
// React renderers live in FilePreview.tsx. Office files are zip archives of
// XML parts, read with fflate and the browser's DOMParser.

import { strFromU8, unzipSync } from 'fflate'

export type Zip = Record<string, Uint8Array>

export function unzip(bytes: Uint8Array): Zip {
  return unzipSync(bytes)
}

export function decodeText(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8').decode(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function xml(zip: Zip, path: string): Document | null {
  const data = zip[path]
  if (!data) return null
  return new DOMParser().parseFromString(strFromU8(data), 'application/xml')
}

/** Descendant elements by local name, ignoring namespace prefixes. Walks the
 *  tree itself: `getElementsByTagNameNS('*', ...)` is not supported everywhere. */
function all(node: Element | Document | null | undefined, name: string): Element[] {
  if (!node) return []
  const out: Element[] = []
  const stack: Element[] = []
  const root = 'documentElement' in node ? (node as Document).documentElement : (node as Element)
  if (!root) return out
  if (root !== node && root.localName === name) out.push(root)
  for (let i = root.children.length - 1; i >= 0; i--) stack.push(root.children[i])
  while (stack.length) {
    const el = stack.pop() as Element
    if (el.localName === name) out.push(el)
    for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i])
  }
  return out
}

function first(node: Element | Document | null | undefined, name: string): Element | null {
  return all(node, name)[0] || null
}

/** Direct children with a given local name. */
function kids(node: Element | null | undefined, name?: string): Element[] {
  if (!node) return []
  return Array.from(node.children).filter((c) => !name || c.localName === name)
}

/** Attribute by local name, so `w:val` and `r:id` are found as `val` and `id`. */
function attr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null
  const plain = el.getAttribute(name)
  if (plain !== null) return plain
  for (const a of Array.from(el.attributes)) {
    if (a.localName === name || a.name.endsWith(`:${name}`)) return a.value
  }
  return null
}

/** The relationship id (`r:id`), not a plain `id` the same element may also carry. */
function relId(el: Element | null | undefined): string | null {
  if (!el) return null
  for (const a of Array.from(el.attributes)) {
    if (a.name.includes(':') && a.localName === 'id') return a.value
    if (a.name.endsWith(':id')) return a.value
  }
  return null
}

function dirname(path: string) {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = (base ? base.split('/') : []).concat(target.split('/'))
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p && p !== '.') out.push(p)
  }
  return out.join('/')
}

/** rId -> absolute part path for the relationships of `partPath`. */
function rels(zip: Zip, partPath: string): Record<string, string> {
  const dir = dirname(partPath)
  const relPath = `${dir ? dir + '/' : ''}_rels/${partPath.split('/').pop()}.rels`
  const doc = xml(zip, relPath)
  const map: Record<string, string> = {}
  for (const r of all(doc, 'Relationship')) {
    const id = r.getAttribute('Id')
    const target = r.getAttribute('Target')
    if (id && target && r.getAttribute('TargetMode') !== 'External') map[id] = resolvePath(dir, target)
  }
  return map
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp',
}

export function imageMime(path: string): string | null {
  return IMAGE_MIME[(path.split('.').pop() || '').toLowerCase()] || null
}

/** Object URL for an image part, or null for formats browsers can't draw (emf, wmf...). */
function imageUrl(zip: Zip, path: string, urls: string[]): string | null {
  const mime = imageMime(path)
  const data = zip[path]
  if (!mime || !data) return null
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }))
  urls.push(url)
  return url
}

// ── XLSX ──────────────────────────────────────────────────────────────────────
export interface Sheet {
  name: string
  rows: string[][]
  totalRows: number
}

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] || 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export function parseXlsx(bytes: Uint8Array, maxRows = 300, maxCols = 40): Sheet[] {
  const zip = unzip(bytes)
  const shared = all(xml(zip, 'xl/sharedStrings.xml'), 'si').map((si) =>
    all(si, 't').map((t) => t.textContent || '').join('')
  )
  const wbPath = 'xl/workbook.xml'
  const wbRels = rels(zip, wbPath)
  const sheets: Sheet[] = []
  for (const s of all(xml(zip, wbPath), 'sheet')) {
    const rid = relId(s)
    const path = rid ? wbRels[rid] : null
    const doc = path ? xml(zip, path) : null
    if (!doc) continue
    const rowEls = all(doc, 'row')
    const rows: string[][] = []
    for (const row of rowEls.slice(0, maxRows)) {
      const cells: string[] = []
      for (const c of kids(row, 'c')) {
        const idx = colIndex(c.getAttribute('r') || '')
        if (idx >= maxCols) continue
        const type = c.getAttribute('t')
        const v = first(c, 'v')?.textContent ?? ''
        let value = v
        if (type === 's') value = shared[Number(v)] ?? ''
        else if (type === 'inlineStr') value = all(c, 't').map((t) => t.textContent || '').join('')
        else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE'
        else if (v && !isNaN(Number(v)) && v.includes('.')) value = String(Math.round(Number(v) * 1e6) / 1e6)
        cells[idx] = value
      }
      rows.push(Array.from(cells, (x) => x ?? ''))
    }
    sheets.push({ name: s.getAttribute('name') || `Sheet ${sheets.length + 1}`, rows, totalRows: rowEls.length })
  }
  return sheets
}

// ── CSV ───────────────────────────────────────────────────────────────────────
export function parseCsv(text: string, maxRows = 500): { rows: string[][]; totalRows: number } {
  const firstLine = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : text.length)
  const delim = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  for (; i < text.length && rows.length < maxRows; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  if (i >= text.length && (field || row.length)) { row.push(field); rows.push(row) }
  let lines = 0
  for (let j = 0; j < text.length; j++) if (text.charCodeAt(j) === 10) lines++
  if (text.length && text[text.length - 1] !== '\n') lines++
  return { rows, totalRows: Math.max(lines, rows.length) }
}

// ── DOCX ──────────────────────────────────────────────────────────────────────
export interface DocRun { text: string; bold?: boolean; italic?: boolean; underline?: boolean; image?: string; br?: boolean }
export type DocBlock =
  | { kind: 'p'; style: 'h1' | 'h2' | 'h3' | 'title' | 'p' | 'li'; runs: DocRun[] }
  | { kind: 'table'; rows: DocBlock[][][] }

export function parseDocx(bytes: Uint8Array, urls: string[]): DocBlock[] {
  const zip = unzip(bytes)
  const path = 'word/document.xml'
  const docRels = rels(zip, path)
  const body = first(xml(zip, path), 'body')

  const paragraph = (p: Element): DocBlock => {
    const styleVal = (attr(first(first(p, 'pPr'), 'pStyle'), 'val') || '').toLowerCase()
    const isList = !!first(first(p, 'pPr'), 'numPr')
    const style: any = styleVal.startsWith('title') ? 'title'
      : /heading ?1|rubrik ?1/.test(styleVal) ? 'h1'
      : /heading ?2|rubrik ?2/.test(styleVal) ? 'h2'
      : /heading ?[3-9]|rubrik ?[3-9]/.test(styleVal) ? 'h3'
      : isList || styleVal.includes('list') ? 'li' : 'p'
    const runs: DocRun[] = []
    for (const r of all(p, 'r')) {
      const rPr = first(r, 'rPr')
      const flag = (n: string) => { const e = first(rPr, n); return !!e && attr(e, 'val') !== '0' && attr(e, 'val') !== 'false' }
      for (const child of Array.from(r.children)) {
        if (child.localName === 't') runs.push({ text: child.textContent || '', bold: flag('b'), italic: flag('i'), underline: !!first(rPr, 'u') })
        else if (child.localName === 'tab') runs.push({ text: '\t' })
        else if (child.localName === 'br') runs.push({ text: '', br: true })
        else if (child.localName === 'drawing' || child.localName === 'pict') {
          const blip = first(child, 'blip') || first(child, 'imagedata')
          const rid = attr(blip, 'embed') || attr(blip, 'id')
          const url = rid && docRels[rid] ? imageUrl(zip, docRels[rid], urls) : null
          if (url) runs.push({ text: '', image: url })
        }
      }
    }
    return { kind: 'p', style, runs }
  }

  const block = (el: Element): DocBlock | null => {
    if (el.localName === 'p') return paragraph(el)
    if (el.localName === 'tbl') {
      return {
        kind: 'table',
        rows: kids(el, 'tr').map((tr) =>
          kids(tr, 'tc').map((tc) => kids(tc).map(block).filter(Boolean) as DocBlock[])
        ),
      }
    }
    if (el.localName === 'sdt') {
      const content = first(el, 'sdtContent')
      return content ? { kind: 'table', rows: [[kids(content).map(block).filter(Boolean) as DocBlock[]]] } : null
    }
    return null
  }
  return kids(body).map(block).filter(Boolean) as DocBlock[]
}

// ── PPTX ──────────────────────────────────────────────────────────────────────
export interface SlideText { text: string; bold?: boolean; italic?: boolean; sizePt?: number; color?: string }
export interface SlidePara { runs: SlideText[]; bullet: boolean; align?: string; level: number }
export type SlideShape =
  | { kind: 'text'; x: number; y: number; w: number; h: number; paras: SlidePara[]; fill?: string; isTitle: boolean; anchor?: string }
  | { kind: 'image'; x: number; y: number; w: number; h: number; url: string }
  | { kind: 'table'; x: number; y: number; w: number; h: number; rows: string[][] }
export interface Slide { index: number; shapes: SlideShape[] }
export interface Deck { width: number; height: number; slides: Slide[] }

interface Xfrm { x: number; y: number; w: number; h: number }

function readXfrm(el: Element | null): Xfrm | null {
  if (!el) return null
  const off = first(el, 'off')
  const ext = first(el, 'ext')
  if (!off || !ext) return null
  return { x: +(off.getAttribute('x') || 0), y: +(off.getAttribute('y') || 0),
    w: +(ext.getAttribute('cx') || 0), h: +(ext.getAttribute('cy') || 0) }
}

function shapeXfrm(sp: Element): Xfrm | null {
  const spPr = kids(sp).find((k) => k.localName === 'spPr' || k.localName === 'xfrm')
  return readXfrm(spPr?.localName === 'xfrm' ? spPr : first(spPr, 'xfrm')) ||
    readXfrm(kids(sp, 'xfrm')[0] || null)
}

function placeholder(sp: Element): { type: string; idx: string } | null {
  const ph = first(first(sp, 'nvPr'), 'ph')
  if (!ph) return null
  return { type: ph.getAttribute('type') || 'body', idx: ph.getAttribute('idx') || '' }
}

/** Placeholder positions defined by a layout or master, by idx and by type. */
function placeholderMap(doc: Document | null): { byIdx: Record<string, Xfrm>; byType: Record<string, Xfrm> } {
  const byIdx: Record<string, Xfrm> = {}
  const byType: Record<string, Xfrm> = {}
  for (const sp of all(doc, 'sp')) {
    const ph = placeholder(sp)
    const xf = shapeXfrm(sp)
    if (!ph || !xf) continue
    if (ph.idx) byIdx[ph.idx] = xf
    if (!byType[ph.type]) byType[ph.type] = xf
  }
  return { byIdx, byType }
}

function srgb(el: Element | null): string | undefined {
  const c = first(el, 'srgbClr')
  const v = c?.getAttribute('val')
  return v ? `#${v}` : undefined
}

export function parsePptx(bytes: Uint8Array, urls: string[]): Deck {
  const zip = unzip(bytes)
  const presPath = 'ppt/presentation.xml'
  const pres = xml(zip, presPath)
  const size = first(pres, 'sldSz')
  const width = +(size?.getAttribute('cx') || 12192000)
  const height = +(size?.getAttribute('cy') || 6858000)
  const presRels = rels(zip, presPath)
  let slidePaths = all(pres, 'sldId').map((s) => presRels[relId(s) || '']).filter(Boolean)
  if (!slidePaths.length) {
    // No usable slide list: fall back to the slide parts in numeric order.
    const num = (p: string) => +(p.match(/slide(\d+)\.xml$/)?.[1] || 0)
    slidePaths = Object.values(presRels).filter((p) => /slides\/slide\d+\.xml$/.test(p)).sort((a, b) => num(a) - num(b))
  }

  const slides: Slide[] = slidePaths.map((path, index) => {
    const doc = xml(zip, path)
    const slideRels = rels(zip, path)
    const layoutPath = Object.values(slideRels).find((p) => p.includes('slideLayouts/'))
    const layoutDoc = layoutPath ? xml(zip, layoutPath) : null
    const masterPath = layoutPath ? Object.values(rels(zip, layoutPath)).find((p) => p.includes('slideMasters/')) : undefined
    const layout = placeholderMap(layoutDoc)
    const master = placeholderMap(masterPath ? xml(zip, masterPath) : null)
    const shapes: SlideShape[] = []

    const position = (el: Element): Xfrm | null => {
      const own = shapeXfrm(el)
      if (own) return own
      const ph = placeholder(el)
      if (!ph) return null
      const type = ph.type === 'ctrTitle' ? 'title' : ph.type === 'subTitle' ? 'body' : ph.type
      return (ph.idx && layout.byIdx[ph.idx]) || layout.byType[ph.type] || layout.byType[type] ||
        (ph.idx && master.byIdx[ph.idx]) || master.byType[type] || master.byType['body'] || null
    }

    const walk = (container: Element, map: (x: Xfrm) => Xfrm) => {
      for (const el of kids(container)) {
        if (el.localName === 'grpSp') {
          const g = first(first(el, 'grpSpPr'), 'xfrm')
          const off = readXfrm(g)
          const chOff = first(g, 'chOff')
          const chExt = first(g, 'chExt')
          const cx = +(chOff?.getAttribute('x') || 0), cy = +(chOff?.getAttribute('y') || 0)
          const cw = +(chExt?.getAttribute('cx') || 0) || off?.w || 1
          const ch = +(chExt?.getAttribute('cy') || 0) || off?.h || 1
          walk(el, (x) => {
            if (!off) return map(x)
            const sx = off.w / cw, sy = off.h / ch
            return map({ x: off.x + (x.x - cx) * sx, y: off.y + (x.y - cy) * sy, w: x.w * sx, h: x.h * sy })
          })
        } else if (el.localName === 'sp') {
          const pos = position(el)
          const txBody = first(el, 'txBody')
          const ph = placeholder(el)
          const isTitle = !!ph && /title/i.test(ph.type)
          const paras: SlidePara[] = all(txBody, 'p').map((p) => {
            const pPr = first(p, 'pPr')
            const bullet = !!first(pPr, 'buChar') || !!first(pPr, 'buAutoNum') ||
              (!!ph && ph.type === 'body' && !first(pPr, 'buNone'))
            return {
              bullet,
              align: pPr?.getAttribute('algn') || undefined,
              level: +(pPr?.getAttribute('lvl') || 0),
              runs: kids(p).filter((r) => r.localName === 'r' || r.localName === 'fld' || r.localName === 'br').map((r) => {
                if (r.localName === 'br') return { text: '\n' }
                const rPr = first(r, 'rPr')
                const sz = rPr?.getAttribute('sz')
                return {
                  text: first(r, 't')?.textContent || '',
                  bold: rPr?.getAttribute('b') === '1',
                  italic: rPr?.getAttribute('i') === '1',
                  sizePt: sz ? +sz / 100 : undefined,
                  color: srgb(first(rPr, 'solidFill')),
                }
              }),
            }
          })
          const hasText = paras.some((p) => p.runs.some((r) => r.text.trim()))
          const fill = srgb(first(first(el, 'spPr'), 'solidFill'))
          if (pos && (hasText || fill)) {
            shapes.push({ kind: 'text', ...map(pos), paras, fill, isTitle,
              anchor: first(txBody, 'bodyPr')?.getAttribute('anchor') || undefined })
          }
        } else if (el.localName === 'pic') {
          const pos = position(el)
          const rid = attr(first(el, 'blip'), 'embed')
          const url = rid && slideRels[rid] ? imageUrl(zip, slideRels[rid], urls) : null
          if (pos && url) shapes.push({ kind: 'image', ...map(pos), url })
        } else if (el.localName === 'graphicFrame') {
          const pos = readXfrm(first(el, 'xfrm'))
          const tbl = first(el, 'tbl')
          if (pos && tbl) {
            shapes.push({ kind: 'table', ...map(pos), rows: all(tbl, 'tr').map((tr) =>
              all(tr, 'tc').map((tc) => all(tc, 't').map((t) => t.textContent || '').join(' '))) })
          }
        }
      }
    }
    const tree = first(first(doc, 'cSld'), 'spTree')
    if (tree) walk(tree, (x) => x)
    return { index: index + 1, shapes }
  })
  return { width, height, slides }
}

// ── Notebooks and zips ────────────────────────────────────────────────────────
export interface NotebookCell { type: 'markdown' | 'code' | 'raw'; source: string; count?: number | null; outputs: { text?: string; image?: string }[] }

export function parseNotebook(text: string): NotebookCell[] {
  const nb = JSON.parse(text)
  const join = (v: unknown) => (Array.isArray(v) ? v.join('') : typeof v === 'string' ? v : '')
  return (nb.cells || []).map((c: any) => ({
    type: c.cell_type,
    source: join(c.source),
    count: c.execution_count,
    outputs: (c.outputs || []).map((o: any) => {
      if (o.output_type === 'stream') return { text: join(o.text) }
      const data = o.data || {}
      if (data['image/png']) return { image: `data:image/png;base64,${join(data['image/png']).trim()}` }
      if (data['text/plain']) return { text: join(data['text/plain']) }
      if (o.output_type === 'error') return { text: `${o.ename}: ${o.evalue}` }
      return {}
    }),
  }))
}

export interface ZipEntry { path: string; size: number; data: Uint8Array }

export function listZip(bytes: Uint8Array): ZipEntry[] {
  const zip = unzip(bytes)
  return Object.entries(zip)
    .filter(([p]) => !p.endsWith('/') && !p.startsWith('__MACOSX/'))
    .map(([path, data]) => ({ path, size: data.length, data }))
    .sort((a, b) => a.path.localeCompare(b.path))
}
