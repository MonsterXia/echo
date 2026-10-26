import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const locales = ['en-US', 'zh-CN']
const fields = new Set(['label', 'title', 'placeholder', 'description', 'message', 'aria-label', 'alt'])
// Technical labels are intentionally identical across languages. Keep exceptions
// tied to a file and value; never exempt whole directories or English sentences.
const literals = {
  'src/renderer/main/components/toolbar/SettingsModal.tsx': ['HDC'],
  'src/renderer/main/components/process/Process.tsx': ['% CPU', 'PID'],
  'src/share/renderer/process/components/ProcessMananger.tsx': ['% CPU', 'PID'],
  'src/share/renderer/process/components/Graph.tsx': ['CPU'],
  'src/renderer/main/components/webview/Webview.tsx': ['URL'],
  'src/renderer/screencast/components/Toolbar.tsx': ['FPS'],
}

export function checkSource(file, source, keys) {
  const errors = []
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const report = (node, message) => errors.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: ${message}`)
  function checkKey(node) {
    if (node && ts.isStringLiteralLike(node)) {
      if (!keys.has(node.text)) report(node, `Unknown translation key: ${node.text}`)
    } else if (node && ts.isConditionalExpression(node)) {
      checkKey(node.whenTrue)
      checkKey(node.whenFalse)
    } else if (node) {
      report(node, 'Use explicit translation keys (conditional literals are supported)')
    }
  }
  function checkLiteral(node) {
    if (!node) return
    if (ts.isJsxExpression(node)) return checkLiteral(node.expression)
    if (ts.isConditionalExpression(node)) {
      checkLiteral(node.whenTrue)
      checkLiteral(node.whenFalse)
    }
    if (!ts.isStringLiteralLike(node) && !ts.isJsxText(node)) return
    const value = node.text.replace(/&(?:nbsp|amp|lt|gt|quot|apos);|&#(?:\d+|x[\da-f]+);/gi, ' ').trim()
    if (/\p{L}/u.test(value) && !literals[file]?.includes(value)) {
      report(node, `Translate visible text: ${JSON.stringify(value)}`)
    }
  }
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') checkKey(node.arguments[0])
    if (ts.isJsxText(node)) checkLiteral(node)
    if (ts.isJsxAttribute(node) && fields.has(node.name.getText(ast))) checkLiteral(node.initializer)
    if (ts.isPropertyAssignment(node) && fields.has(node.name.getText(ast).replace(/^['"]|['"]$/g, ''))) checkLiteral(node.initializer)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return errors
}

export function checkCatalogPair(english, chinese, label) {
  const errors = []
  const placeholders = value => [...String(value).matchAll(/{{\s*([^{}\s]+)\s*}}/g)].map(match => match[1]).sort()
  for (const key of new Set([...Object.keys(english), ...Object.keys(chinese)])) {
    for (const [locale, catalog] of [['en-US', english], ['zh-CN', chinese]]) {
      if (typeof catalog[key] !== 'string' || !catalog[key].trim()) errors.push(`${label}/${locale}: missing or empty ${key}`)
    }
    if (JSON.stringify(placeholders(english[key])) !== JSON.stringify(placeholders(chinese[key]))) errors.push(`${label}: placeholder mismatch for ${key}`)
  }
  return errors
}

function files(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(root, entry.name)
    return entry.isDirectory() ? files(file) : [file]
  })
}

export function checkProject(root = process.cwd()) {
  const errors = []
  const allKeys = new Set()
  for (const layer of ['src/common/langs', 'src/share/common/langs']) {
    const catalogs = locales.map(locale => {
      const file = `${layer}/${locale}.json`
      let source
      try { source = fs.readFileSync(path.join(root, file), 'utf8') }
      catch { errors.push(`${file}: catalog not found`); return {} }
      const ast = ts.parseJsonText(file, source)
      const seen = new Set()
      const object = ast.statements[0]?.expression
      for (const property of object?.properties || []) {
        const key = property.name?.text
        if (seen.has(key)) errors.push(`${file}: duplicate key ${key}`)
        seen.add(key)
      }
      try { return JSON.parse(source) }
      catch { errors.push(`${file}: invalid JSON`); return {} }
    })
    errors.push(...checkCatalogPair(catalogs[0], catalogs[1], layer))
    Object.keys(catalogs[0]).forEach(key => allKeys.add(key))
  }
  for (const absolute of files(path.join(root, 'src'))) {
    if (!/\.tsx?$/.test(absolute)) continue
    const relative = path.relative(root, absolute).split(path.sep).join('/')
    errors.push(...checkSource(relative, fs.readFileSync(absolute, 'utf8'), allKeys))
  }
  return errors
}
