import assert from 'node:assert/strict'
import {readdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'

const directory = join(process.argv[2] || 'dist', 'assets')
const files = (await readdir(directory)).filter(name => name.endsWith('.js'))
assert.ok(files.length > 0, 'No client assets to verify')

const marker = /INC000021940112|INC000021940126|demo-auth-17|Демо: новый крит|Демоминута:/
for (const name of files) {
  const source = await readFile(join(directory, name), 'utf8')
  assert.ok(!marker.test(source), `Demo fixture or generator bundled in ${name}`)
}
console.log('Live client assets contain no local demo fixture or generator markers.')
