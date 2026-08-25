import { num } from '../lib/index.js'

const assert = (c, m) => {
  if (!c) {
    console.error('FAIL: ' + m)
    process.exit(1)
  }
}
assert(num(3) === 3, 'finite number passthrough')
assert(num(-0.25) === -0.25, 'finite negative number passthrough')
assert(num('12.5') === null, 'numeric string -> null (strict)')
assert(num('abc') === null, 'non-numeric -> null')
assert(num(null) === null, 'null -> null')
assert(num(Infinity) === null, 'Infinity -> null')
console.log('PASS: num strict coercion')
