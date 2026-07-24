// Diagnostic Zadarma : solde, postes SIP et statut en ligne de chaque poste.
// Usage : node scripts/zadarma-status.mjs
// Lit ZADARMA_API_KEY / ZADARMA_API_SECRET dans .env.local ou .env.vercel (jamais affichés).

import { readFileSync } from 'fs'
import { createHmac, createHash } from 'crypto'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = {}
for (const file of ['.env.local', '.env.vercel']) {
  try {
    for (const line of readFileSync(join(ROOT, file), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  } catch {}
}
const KEY = env.ZADARMA_API_KEY, SECRET = env.ZADARMA_API_SECRET
if (!KEY || !SECRET) { console.error('❌ Clés Zadarma introuvables (.env.local / .env.vercel)'); process.exit(1) }

// Signature Zadarma : base64( hex_hmac_sha1( method + params + md5(params), secret ) )
function sign(method, paramsString) {
  const md5 = createHash('md5').update(paramsString).digest('hex')
  const hex = createHmac('sha1', SECRET).update(method + paramsString + md5).digest('hex')
  return Buffer.from(hex).toString('base64')
}

async function zadarma(method, params = {}) {
  const paramsString = new URLSearchParams(Object.entries(params).sort()).toString()
  const url = `https://api.zadarma.com${method}${paramsString ? '?' + paramsString : ''}`
  const r = await fetch(url, { headers: { Authorization: `${KEY}:${sign(method, paramsString)}` } })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.status === 'error') throw new Error(`${method} → ${r.status} ${data.message || ''}`)
  return data
}

console.log('\n🏦 SOLDE')
try {
  const b = await zadarma('/v1/info/balance/')
  console.log(`   ${b.balance} ${b.currency}`)
} catch (e) { console.log('   ⚠️ ' + e.message) }

console.log('\n📞 POSTES SIP')
let sips = []
try {
  const s = await zadarma('/v1/sip/')
  sips = s.sips || []
  for (const sip of sips) console.log(`   ${sip.id}  «${sip.display_name || ''}»  lignes: ${sip.lines}`)
} catch (e) { console.log('   ⚠️ ' + e.message) }

console.log('\n🟢/🔴 STATUT EN LIGNE DES POSTES (le nerf de la guerre)')
for (const sip of sips) {
  try {
    const st = await zadarma(`/v1/sip/${sip.id}/status/`)
    const online = st.is_online === 'true' || st.is_online === true
    console.log(`   ${sip.id}  ${online ? '🟢 EN LIGNE (enregistré)' : '🔴 HORS LIGNE — ne peut PAS recevoir'}`)
  } catch (e) { console.log(`   ${sip.id}  ⚠️ ${e.message}`) }
}

console.log('\n☎️ POSTES INTERNES PBX')
try {
  const p = await zadarma('/v1/pbx/internal/')
  const nums = p.numbers || []
  console.log('   Postes: ' + nums.join(', '))
} catch (e) { console.log('   ⚠️ ' + e.message) }
console.log()
