import { displayBilingualText, pickBilingual, splitSlashBilingual } from './bilingual.ts'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const parts = splitSlashBilingual('Open a shift first / افتح وردية أولاً')
assert(parts.message === 'Open a shift first', 'en side')
assert(parts.messageAr.includes('افتح'), 'ar side')
assert(pickBilingual(parts.message, parts.messageAr, 'ar').includes('افتح'), 'ar pick')
assert(pickBilingual(parts.message, parts.messageAr, 'en') === 'Open a shift first', 'en pick')
assert(
  displayBilingualText({ message: 'Hello', messageAr: 'مرحبا' }, 'ar') === 'مرحبا',
  'explicit fields',
)

console.log('bilingual.selftest: OK')
