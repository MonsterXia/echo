import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import * as sass from 'sass'
import postcss from 'postcss'
import autoprefixer from 'autoprefixer'
import selectorParser from 'postcss-selector-parser'

export function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    return entry.isDirectory() ? sourceFiles(file) : [file]
  }).sort()
}

export function prefixSelectors(css, name) {
  const sheet = postcss.parse(css)
  sheet.walkRules((rule) => {
    rule.selector = selectorParser((selectors) => {
      selectors.walk((node) => {
        if (['class', 'id'].includes(node.type) && !node.value.startsWith('luna-')) {
          node.value = `${name}-${node.value}`
        }
        if (node.type === 'attribute' && node.attribute === 'class' &&
            ((node.operator === '^=' && node.value === 'icon-') ||
             (node.operator === '*=' && node.value === ' icon-'))) {
          node.setValue(node.value.replace('icon-', `${name}-icon-`), { quoteMark: '"' })
        }
      })
    }).processSync(rule.selector)
  })
  return sheet.toString()
}

function outputDirectory(packageDir, output) {
  const root = fs.realpathSync(packageDir)
  const destination = path.resolve(root, output)
  // Only these generated children can be removed; never follow an output link.
  if (!['dist', 'cjs', 'esm'].includes(output) || path.dirname(destination) !== root) {
    throw new Error(`Invalid generated output: ${destination}`)
  }
  if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) {
    throw new Error(`Generated output must not be a link: ${destination}`)
  }
  return destination
}

function compile(packageDir, files, output, module, removeComments) {
  const outDir = outputDirectory(packageDir, output)
  const program = ts.createProgram(files, {
    rootDir: path.join(packageDir, 'src'), outDir,
    target: ts.ScriptTarget.ES2020, module,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    ignoreDeprecations: '6.0',
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    useDefineForClassFields: false, declaration: true,
    allowJs: true, noResolve: true, noCheck: true, removeComments,
  })
  const syntax = program.getSyntacticDiagnostics()
  const emitted = new Map()
  const result = syntax.length ? { diagnostics: syntax, emitSkipped: true } : program.emit(
    undefined, (file, content) => emitted.set(path.resolve(file), content)
  )
  if (result.emitSkipped || result.diagnostics.some((d) => d.category === ts.DiagnosticCategory.Error)) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(result.diagnostics, {
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => packageDir,
      getNewLine: () => '\n',
    }) || `Failed to compile ${packageDir}`)
  }
  // Preserve valid output on syntax errors and avoid missing-file races with Vite
  // watchers. Publish only changed files after the entire program has emitted.
  for (const [file, content] of emitted) {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) continue
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temporary = file + '.tmp'
    fs.writeFileSync(temporary, content)
    fs.renameSync(temporary, file)
  }
  for (const file of sourceFiles(outDir)) {
    if (!emitted.has(path.resolve(file))) fs.unlinkSync(file)
  }
}

export async function buildPackage(packageDir) {
  packageDir = fs.realpathSync(packageDir)
  const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'))
  if (pkg.name === 'licia') return
  const files = sourceFiles(path.join(packageDir, 'src')).filter((f) => /\.(ts|tsx|js)$/.test(f) && !f.endsWith('.d.ts'))
  if (!files.length) throw new Error(`No runtime source in ${pkg.name}`)
  if (pkg.name === 'hdckit') {
    compile(packageDir, files, 'dist', ts.ModuleKind.CommonJS, false)
    return
  }
  if (!pkg.name.startsWith('luna-')) throw new Error(`Unsupported local package ${pkg.name}`)
  compile(packageDir, files, 'cjs', ts.ModuleKind.CommonJS, true)
  compile(packageDir, files, 'esm', ts.ModuleKind.ES2020, true)
  const component = pkg.name.slice(5)
  const config = JSON.parse(fs.readFileSync(path.join(packageDir, 'component.json'), 'utf8'))
  const dir = path.join(packageDir, 'src', component)
  let css = ''
  if (config.luna?.icon) css += fs.readFileSync(path.join(dir, 'icon.css'), 'utf8') + '\n'
  const style = path.join(dir, 'style.scss')
  if (fs.existsSync(style)) {
    css += sass.compile(style, { style: 'expanded', logger: sass.Logger.silent }).css
  }
  const result = await postcss([autoprefixer()]).process(prefixSelectors(css, pkg.name), { from: undefined })
  fs.writeFileSync(path.join(packageDir, pkg.name + '.css'), result.css + '\n')
}
