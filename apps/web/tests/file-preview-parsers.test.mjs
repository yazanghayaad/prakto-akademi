// Parses real Office, CSV, notebook and zip files with the in-app preview
// parsers (components/Objects/Media/FilePreview/ooxml.ts).
//
// Fixtures are built in the test: minimal but valid OOXML packages, so the
// test needs no binary files in the repo.
import { describe, expect, test, beforeAll } from 'bun:test'
import { Window } from 'happy-dom'
import { strToU8, zipSync } from 'fflate'

let P
beforeAll(async () => {
  const win = new Window()
  globalThis.DOMParser = win.DOMParser
  globalThis.URL.createObjectURL = () => 'blob:test'
  P = await import('../components/Objects/Media/FilePreview/ooxml.ts')
})

const rel = (id, target) => `<Relationship Id="${id}" Type="x" Target="${target}"/>`
const rels = (...items) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join('')}</Relationships>`
const pkg = (files) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])))
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

describe('xlsx', () => {
  test('reads sheets, shared strings and numbers', () => {
    const bytes = pkg({
      'xl/workbook.xml': `<workbook ${NS}><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': rels(rel('rId1', 'worksheets/sheet1.xml')),
      'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Price</t></si><si><t>Volvo</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>21.5</v></c></row></sheetData></worksheet>',
    })
    const [sheet] = P.parseXlsx(bytes)
    expect(sheet.name).toBe('Data')
    expect(sheet.rows).toEqual([['Name', 'Price'], ['Volvo', '21.5']])
  })
})

describe('csv', () => {
  test('handles quotes, commas and semicolons', () => {
    expect(P.parseCsv('a,b\n"x, y",2\n').rows).toEqual([['a', 'b'], ['x, y', '2']])
    expect(P.parseCsv('a;b\n1;2').rows).toEqual([['a', 'b'], ['1', '2']])
    expect(P.parseCsv('a\n1\n2\n3\n', 2)).toEqual({ rows: [['a'], ['1']], totalRows: 4 })
  })
})

describe('docx', () => {
  test('reads headings, bold runs and tables', () => {
    const bytes = pkg({
      'word/document.xml': `<w:document ${NS}><w:body>
        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Rubrik</w:t></w:r></w:p>
        <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Fet</w:t></w:r><w:r><w:t> text</w:t></w:r></w:p>
        <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      </w:body></w:document>`,
    })
    const blocks = P.parseDocx(bytes, [])
    expect(blocks[0]).toMatchObject({ kind: 'p', style: 'h1', runs: [{ text: 'Rubrik' }] })
    expect(blocks[1].runs[0]).toMatchObject({ text: 'Fet', bold: true })
    expect(blocks[2].kind).toBe('table')
  })
})

describe('pptx', () => {
  test('reads slides, positions and inherits placeholder positions from the layout', () => {
    const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`
    const bytes = pkg({
      'ppt/presentation.xml': `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`,
      'ppt/_rels/presentation.xml.rels': rels(rel('rId2', 'slides/slide1.xml')),
      'ppt/slides/slide1.xml': `<p:sld ${NS}><p:cSld><p:spTree>
        <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:p><a:r><a:t>Titel</a:t></a:r></a:p></p:txBody></p:sp>
        <p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(100, 200, 300, 400)}</p:spPr><p:txBody><a:p><a:r><a:rPr sz="2400" b="1"/><a:t>Punkt</a:t></a:r></a:p></p:txBody></p:sp>
      </p:spTree></p:cSld></p:sld>`,
      'ppt/slides/_rels/slide1.xml.rels': rels(rel('rId1', '../slideLayouts/slideLayout1.xml')),
      'ppt/slideLayouts/slideLayout1.xml': `<p:sldLayout ${NS}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(10, 20, 30, 40)}</p:spPr></p:sp></p:spTree></p:cSld></p:sldLayout>`,
    })
    const deck = P.parsePptx(bytes, [])
    expect(deck.width).toBe(9144000)
    expect(deck.slides).toHaveLength(1)
    const [title, body] = deck.slides[0].shapes
    expect(title).toMatchObject({ kind: 'text', x: 10, y: 20, isTitle: true })
    expect(body).toMatchObject({ x: 100, y: 200, w: 300, h: 400 })
    expect(body.paras[0].runs[0]).toMatchObject({ text: 'Punkt', sizePt: 24, bold: true })
  })
})

describe('notebook and zip', () => {
  test('reads notebook cells and outputs', () => {
    const cells = P.parseNotebook(JSON.stringify({ cells: [
      { cell_type: 'markdown', source: ['# Hej'] },
      { cell_type: 'code', source: 'print(1)', execution_count: 3, outputs: [{ output_type: 'stream', text: ['1\n'] }] },
    ] }))
    expect(cells[0]).toMatchObject({ type: 'markdown', source: '# Hej' })
    expect(cells[1]).toMatchObject({ type: 'code', count: 3, outputs: [{ text: '1\n' }] })
  })

  test('lists zip entries without folders', () => {
    const entries = P.listZip(pkg({ 'a.csv': 'x', 'dir/b.png': 'y', '__MACOSX/._a': 'z' }))
    expect(entries.map((e) => e.path)).toEqual(['a.csv', 'dir/b.png'])
  })
})
