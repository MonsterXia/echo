import { checkProject } from './lib/i18n-check.mjs'

const errors = checkProject()
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log('i18n: catalogs, placeholders, translation keys and visible literals checked')
}
