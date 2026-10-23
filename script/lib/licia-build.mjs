// Adapted from Licia's MIT-licensed lib/build.js at the version recorded in
// vendor/manifest.json. Original helpers are retained in licia/upstream/.
import fs from 'node:fs'
import path from 'node:path'
import { transformSync } from '@babel/core'
import arrowFunctions from '@babel/plugin-transform-arrow-functions'
import templateLiterals from '@babel/plugin-transform-template-literals'
import blockScoping from '@babel/plugin-transform-block-scoping'
import destructuring from '@babel/plugin-transform-destructuring'
import parameters from '@babel/plugin-transform-parameters'
import shorthandProperties from '@babel/plugin-transform-shorthand-properties'
import ts from 'typescript'

const dependenciesPattern = /\s*\b_\(\s*['"]([\w\s$]+)['"]\s*\);?/m
const browserTransforms = [arrowFunctions, templateLiterals, blockScoping,
  destructuring, parameters, shorthandProperties]

export function sourceComment(source, name) {
  const match = source.match(new RegExp('/\\* ' + name + '\\b([\\s\\S]*?)\\*/'))
  return (match?.[1] ?? '').split('\n').map(line => line.replace(/^\s*\* ?/, '')).join('\n').trim()
}

export function moduleMetadata(source) {
  const fields = Object.fromEntries(sourceComment(source, 'module').split('\n')
    .map(line => line.trim().split(/:\s*/, 2)).filter(parts => parts.length === 2))
  const env = (fields.env ?? 'all').split(/\s+/)
  return { env: env.includes('all') ? ['node', 'browser', 'miniprogram'] : env,
    test: fields.test }
}

export function buildLicia(packageDir, { testMode = false } = {}) {
  const sourceDir = path.join(packageDir, 'src')
  const files = fs.readdirSync(sourceDir).filter(file => file.endsWith('.js')).sort()
  if (!files.length) throw new Error('No Licia source modules')
  const names = new Set(files.map(file => file.slice(0, -3)))
  const outputs = new Map()
  const indexes = { node: [], browser: [] }
  for (const file of files) {
    const name = file.slice(0, -3)
    if (!/^[a-zA-Z_$][\w$]*$/.test(name) || ['node', 'browser', 'index'].includes(name)) {
      throw new Error(`Invalid Licia module name: ${name}`)
    }
    let source = fs.readFileSync(path.join(sourceDir, file), 'utf8')
    const metadata = moduleMetadata(source)
    if (metadata.env.some(env => !['node', 'browser', 'miniprogram'].includes(env))) {
      throw new Error(`Unknown Licia environment in ${name}`)
    }
    for (const env of Object.keys(indexes)) if (metadata.env.includes(env)) indexes[env].push(name)
    const dependencies = source.match(dependenciesPattern)?.[1].trim().split(/\s+/) ?? []
    for (const dependency of dependencies) {
      if (!names.has(dependency)) throw new Error(`Unknown Licia dependency ${dependency} in ${name}`)
    }
    let types = sourceComment(source, 'typescript').replace(/export declare/g, 'declare')
    // Native globals (e.g. Blob) intentionally have an empty type block.
    if (!/\/\* typescript\b/.test(source)) throw new Error(`Missing Licia type block in ${name}`)
    const typeImports = dependencies.filter(dependency => types.includes(dependency))
      .map(dependency => `import ${dependency} = require('./${dependency}');`).join('\n')
    const declaration = [typeImports, types, `export = ${name};`].filter(Boolean).join('\n\n') + '\n'
    const typeSyntax = ts.createSourceFile(name + '.d.ts', declaration, ts.ScriptTarget.Latest, true).parseDiagnostics
    if (typeSyntax.length) throw new Error(`Invalid Licia declaration in ${name}: ${typeSyntax.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')}`)
    outputs.set(name + '.d.ts', declaration)
    const isEs5 = metadata.env.some(env => ['browser', 'miniprogram'].includes(env))
    source = source.replace(dependenciesPattern, '\n' + dependencies.filter(dep => dep !== 'types')
      .map(dependency => `${isEs5 ? 'var' : 'const'} ${dependency} = require('./${dependency}');`).join('\n') + '\n')
      .replace(/LICIA_TEST/g, testMode ? 'true' : 'false') + '\nmodule.exports = exports;\n'
    const result = transformSync(source, { filename: path.join(sourceDir, file),
      babelrc: false, configFile: false, sourceType: 'script', comments: false,
      plugins: isEs5 ? browserTransforms : [],
    })
    outputs.set(name + '.js', result.code + '\n')
  }
  for (const [env, modules] of Object.entries(indexes)) {
    outputs.set(env + '.js', modules.map(name => `exports.${name} = require('./${name}');`).join('\n') + '\n')
    outputs.set(env + '.d.ts', modules.map(name => `export import ${name} = require('./${name}');`).join('\n') + '\n')
  }
  outputs.set('index.d.ts', "export * from './browser';\nexport * from './node';\n")

  // Validate every source before publishing anything. Only generated root files
  // are replaced/removed; src/, test/, upstream/ and metadata remain untouched.
  for (const [name, content] of outputs) {
    const output = path.join(packageDir, name)
    if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) throw new Error(`Generated output is a link: ${output}`)
    if (fs.existsSync(output) && fs.readFileSync(output, 'utf8') === content) continue
    fs.writeFileSync(output + '.tmp', content)
    fs.renameSync(output + '.tmp', output)
  }
  for (const entry of fs.readdirSync(packageDir, { withFileTypes: true })) {
    if (entry.isFile() && /\.(js|d\.ts)$/.test(entry.name) && !outputs.has(entry.name)) {
      fs.unlinkSync(path.join(packageDir, entry.name))
    }
  }
}
