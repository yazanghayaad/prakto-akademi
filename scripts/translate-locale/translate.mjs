#!/usr/bin/env node
// Translates the web UI strings (apps/web/locales/en.json) into another language
// with any OpenAI-compatible chat model (e.g. Kimi K3 served on Modal).
//
//   node scripts/translate-locale/translate.mjs --lang sv
//
// Translations are cached per English source string in cache/<lang>.json, so a
// re-run only sends strings that are new or whose English text changed (e.g.
// after pulling upstream LearnHouse updates). See README.md for all options.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(TOOL_DIR, '..', '..')

// ── CLI ───────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    lang: 'sv',
    source: path.join(REPO_ROOT, 'apps/web/locales/en.json'),
    out: null,
    config: null,
    env: path.join(REPO_ROOT, 'apps/api/.env'),
    batchChars: 5000,
    batchKeys: 80,
    concurrency: 4,
    limit: 0,
    rounds: 3,
    reasoning: 'low',
    retranslate: false,
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    switch (a) {
      case '--lang': args.lang = next(); break
      case '--source': args.source = path.resolve(next()); break
      case '--out': args.out = path.resolve(next()); break
      case '--config': args.config = path.resolve(next()); break
      case '--env': args.env = path.resolve(next()); break
      case '--batch-chars': args.batchChars = Number(next()); break
      case '--batch-keys': args.batchKeys = Number(next()); break
      case '--concurrency': args.concurrency = Number(next()); break
      case '--limit': args.limit = Number(next()); break
      case '--rounds': args.rounds = Number(next()); break
      case '--reasoning': args.reasoning = next(); break
      case '--retranslate': args.retranslate = true; break
      case '--dry-run': args.dryRun = true; break
      case '-h': case '--help':
        console.log(fs.readFileSync(path.join(TOOL_DIR, 'README.md'), 'utf8'))
        process.exit(0)
      default:
        console.error(`Okänd flagga: ${a} (se --help)`)
        process.exit(2)
    }
  }
  args.out ??= path.join(path.dirname(args.source), `${args.lang}.json`)
  return args
}

// ── Model config ──────────────────────────────────────────────────────────────
// Priority: TRANSLATE_* env vars > --config file > LearnHouse API .env.
function readKeyValueFile(file) {
  const out = {}
  if (!file || !fs.existsSync(file)) return out
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Za-z0-9_.-]+)\s*[=:]\s*(.*)$/)
    if (m) out[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

function resolveModelConfig(args) {
  const cfg = readKeyValueFile(args.config)
  const env = readKeyValueFile(args.env)
  const pick = (...vals) => vals.find((v) => typeof v === 'string' && v.length > 0)
  const baseUrl = pick(
    process.env.TRANSLATE_BASE_URL,
    cfg.base_url, cfg.url, cfg.modal_base_url,
    env.learnhouse_ai_base_url,
  )
  const apiKey = pick(
    process.env.TRANSLATE_API_KEY,
    cfg.api_key, cfg.modal_api_key, cfg.key,
    env.learnhouse_ai_api_key,
  )
  const model = pick(
    process.env.TRANSLATE_MODEL,
    cfg.model,
    env.learnhouse_ai_model_standard, env.learnhouse_ai_model_fast,
  )
  const missing = [!baseUrl && 'base_url', !apiKey && 'api_key', !model && 'model'].filter(Boolean)
  if (missing.length) {
    console.error(`Saknar modellinställningar: ${missing.join(', ')}.`)
    console.error('Ange TRANSLATE_BASE_URL/TRANSLATE_API_KEY/TRANSLATE_MODEL, en --config-fil eller LEARNHOUSE_AI_* i apps/api/.env.')
    process.exit(2)
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, model }
}

// ── Locale file helpers ───────────────────────────────────────────────────────
// Leaves are addressed by their dotted key, which is also what i18next uses.
function flatten(node, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') {
      if (out.has(key)) throw new Error(`Dubblettnyckel efter platt­ning: ${key}`)
      out.set(key, v)
    } else if (v && typeof v === 'object') {
      flatten(v, key, out)
    }
  }
  return out
}

// Rebuild the source tree in source order, keeping only translated leaves, so
// untranslated strings fall back to English at runtime.
function buildTree(node, translations, prefix = '') {
  const isArr = Array.isArray(node)
  const out = isArr ? [] : {}
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k
    let val
    if (typeof v === 'string') val = translations.get(key)
    else if (v && typeof v === 'object') {
      val = buildTree(v, translations, key)
      if (Object.keys(val).length === 0) val = undefined
    }
    if (val === undefined) continue
    if (isArr) out.push(val)
    else out[k] = val
  }
  return out
}

// On Windows an editor, file watcher or virus scanner can hold the target open
// for a moment, which makes the rename fail with EPERM/EBUSY. Retry briefly,
// then fall back to writing the file in place.
async function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const text = JSON.stringify(data, null, 2) + '\n'
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, text, 'utf8')
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      fs.renameSync(tmp, file)
      return
    } catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e
      await sleep(100 * attempt)
    }
  }
  fs.writeFileSync(file, text, 'utf8')
  fs.rmSync(tmp, { force: true })
}

// ── Validation ────────────────────────────────────────────────────────────────
// Everything the UI code substitutes or parses must survive translation intact.
const TOKEN_RE = /\{\{[^{}]*\}\}|\$t\([^)]*\)|<\/?[A-Za-z0-9]+(?:\s[^<>]*)?\/?>|%[sd]|\{[A-Za-z0-9_]+\}/g

function tokens(s) {
  return (s.match(TOKEN_RE) ?? []).map((t) => t.replace(/\s+/g, '')).sort()
}

function validate(src, out) {
  if (typeof out !== 'string') return 'inte en sträng'
  if (src.trim() !== '' && out.trim() === '') return 'tom översättning'
  const a = tokens(src), b = tokens(out)
  if (a.length !== b.length || a.some((t, i) => t !== b[i])) {
    return `platshållare ändrade (${a.join(' ')} → ${b.join(' ')})`
  }
  return null
}

// ── Prompt ────────────────────────────────────────────────────────────────────
function loadGlossary(lang) {
  const file = path.join(TOOL_DIR, `glossary.${lang}.json`)
  if (!fs.existsSync(file)) return { language: lang, style: [], terms: {}, keep: [] }
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function systemPrompt(g) {
  const terms = Object.entries(g.terms ?? {}).map(([en, tr]) => `- ${en} → ${tr}`).join('\n')
  return [
    `You translate the user interface of a web-based learning platform from English to ${g.language}.`,
    'You receive a JSON object whose keys are i18n keys and whose values are English UI strings.',
    'Reply with a JSON object with exactly the same keys, each value translated. Output JSON only.',
    '',
    'Hard rules:',
    '- Never change, translate or drop anything inside {{ }}, $t( ), <tags> such as <1> or <strong>, %s, %d or {name}. Keep each one exactly once.',
    '- Keep line breaks, Markdown and leading/trailing punctuation as in the source.',
    '- Keys ending in _one, _other, _zero etc. are plural forms: translate each form for its count.',
    '- Use the key to understand where the text appears (button, title, error, tooltip) and match that.',
    '- If a value is a code, URL, file name or brand name, return it unchanged.',
    ...(g.style?.length ? ['', 'Style:', ...g.style.map((s) => `- ${s}`)] : []),
    ...(g.keep?.length ? ['', `Keep these names unchanged: ${g.keep.join(', ')}.`] : []),
    ...(terms ? ['', 'Use these terms consistently:', terms] : []),
  ].join('\n')
}

// ── Model call ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function callModel(model, system, batch, args) {
  const body = {
    model: model.model,
    temperature: 0.2,
    max_tokens: 16000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(Object.fromEntries(batch), null, 1) },
    ],
  }
  if (args.reasoning && args.reasoning !== 'none') body.reasoning_effort = args.reasoning

  for (let attempt = 1; ; attempt++) {
    let res
    try {
      res = await fetch(`${model.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${model.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300_000),
      })
    } catch (e) {
      if (attempt >= 4) throw new Error(`nätverksfel: ${e.message}`)
      await sleep(2000 * attempt)
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 4) throw new Error(`HTTP ${res.status}`)
      await sleep(3000 * attempt)
      continue
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = await res.json()
    const choice = data.choices?.[0]
    if (choice?.finish_reason === 'length') throw new Error('svaret blev för långt (minska --batch-chars)')
    const text = (choice?.message?.content ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
    try {
      return JSON.parse(text)
    } catch {
      if (attempt >= 3) throw new Error('svaret var inte giltig JSON')
    }
  }
}

// ── Batching and worker pool ─────────────────────────────────────────────────
function makeBatches(entries, maxChars, maxKeys) {
  const batches = []
  let cur = [], size = 0
  for (const e of entries) {
    const len = e[0].length + e[1].length
    if (cur.length && (size + len > maxChars || cur.length >= maxKeys)) {
      batches.push(cur)
      cur = [], size = 0
    }
    cur.push(e)
    size += len
  }
  if (cur.length) batches.push(cur)
  return batches
}

async function runPool(items, concurrency, worker) {
  let next = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      await worker(items[i], i)
    }
  })
  await Promise.all(runners)
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const sourceTree = JSON.parse(fs.readFileSync(args.source, 'utf8'))
  const source = flatten(sourceTree)
  const cacheFile = path.join(TOOL_DIR, 'cache', `${args.lang}.json`)
  const cache = !args.retranslate && fs.existsSync(cacheFile)
    ? JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    : {}

  // A cached translation is reused only while its English source is unchanged.
  let todo = [...source].filter(([k, en]) => cache[k]?.src !== en)
  const upToDate = source.size - todo.length
  if (args.limit > 0) todo = todo.slice(0, args.limit)

  console.log(`Källa: ${path.relative(REPO_ROOT, args.source)} (${source.size} texter)`)
  console.log(`Redan översatta: ${upToDate}. Att översätta nu: ${todo.length}.`)

  const glossary = loadGlossary(args.lang)
  const system = systemPrompt(glossary)

  if (args.dryRun) {
    const batches = makeBatches(todo, args.batchChars, args.batchKeys)
    console.log(`Torrkörning: ${batches.length} anrop till modellen. Inget skickas.`)
    return
  }

  const model = resolveModelConfig(args)
  console.log(`Modell: ${model.model} via ${new URL(model.baseUrl).host}`)

  // Progress is saved at most every few seconds; a failed save is reported but
  // never stops the run, since the final save at the end writes everything.
  let saveChain = Promise.resolve()
  let lastSave = 0
  const saveCache = () => {
    if (Date.now() - lastSave < 3000) return saveChain
    lastSave = Date.now()
    saveChain = saveChain
      .then(() => writeJsonAtomic(cacheFile, cache))
      .catch((e) => console.warn(`\nKunde inte spara mellanresultat: ${e.message}`))
    return saveChain
  }

  const failures = new Map()
  let pending = todo
  let done = 0
  const started = Date.now()

  for (let round = 1; round <= args.rounds && pending.length; round++) {
    // Later rounds retry only failed strings, in ever smaller batches.
    const keysPerBatch = round === 1 ? args.batchKeys : round === 2 ? 10 : 1
    const batches = makeBatches(pending, args.batchChars, keysPerBatch)
    if (round > 1) console.log(`\nOmgång ${round}: försöker igen med ${pending.length} texter.`)
    const retry = []

    await runPool(batches, args.concurrency, async (batch) => {
      let result
      try {
        result = await callModel(model, system, batch, args)
      } catch (e) {
        for (const [k, en] of batch) { failures.set(k, e.message); retry.push([k, en]) }
        return
      }
      for (const [k, en] of batch) {
        const problem = validate(en, result?.[k])
        if (problem) { failures.set(k, problem); retry.push([k, en]); continue }
        cache[k] = { src: en, out: result[k] }
        failures.delete(k)
        done++
      }
      await saveCache()
      const secs = Math.round((Date.now() - started) / 1000)
      process.stdout.write(`\r  ${done}/${todo.length} översatta (${secs} s)   `)
    })
    pending = retry
  }
  await saveChain
  process.stdout.write('\n')

  // Drop cache entries for keys that no longer exist upstream.
  for (const k of Object.keys(cache)) if (!source.has(k)) delete cache[k]
  await writeJsonAtomic(cacheFile, cache)

  const translations = new Map(
    [...source.keys()].filter((k) => cache[k]?.src === source.get(k)).map((k) => [k, cache[k].out]),
  )
  await writeJsonAtomic(args.out, buildTree(sourceTree, translations))

  console.log(`Skrev ${path.relative(REPO_ROOT, args.out)}: ${translations.size}/${source.size} texter översatta.`)
  if (failures.size) {
    console.log(`${failures.size} texter misslyckades och visas på engelska tills vidare:`)
    for (const [k, why] of [...failures].slice(0, 20)) console.log(`  - ${k}: ${why}`)
    if (failures.size > 20) console.log(`  … och ${failures.size - 20} till. Kör verktyget igen för att försöka på nytt.`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
