// Récap des encaissements Qonto (crédits complétés) pour une année donnée.
// Usage : node scripts/qonto-encaissements.mjs [année]   (défaut : 2025)
// Lit QONTO_LOGIN et QONTO_SECRET_KEY dans .env.local (jamais affichés).

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const YEAR = process.argv[2] || '2025'
const IBAN = 'FR7616958000011144672670309'

// Charger .env.local puis .env.vercel (pull Vercel) — le premier trouvé gagne
const env = {}
for (const file of ['.env.local', '.env.vercel']) {
  try {
    for (const line of readFileSync(join(ROOT, file), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  } catch {}
}
const LOGIN = (env.QONTO_LOGIN || '').trim()
const SECRET = (env.QONTO_SECRET_KEY || '').trim()
if (!LOGIN || !SECRET) {
  console.error('❌ QONTO_LOGIN / QONTO_SECRET_KEY manquants dans .env.local')
  process.exit(1)
}

async function qonto(path) {
  const r = await fetch(`https://thirdparty.qonto.com/v2${path}`, {
    headers: { Authorization: `${LOGIN}:${SECRET}` },
  })
  if (!r.ok) throw new Error(`Qonto ${r.status}: ${(await r.text()).substring(0, 200)}`)
  return r.json()
}

// Paginer toutes les transactions crédit complétées de l'année
const from = `${YEAR}-01-01T00:00:00.000Z`
const to = `${Number(YEAR) + 1}-01-01T00:00:00.000Z`
let page = 1, all = []
for (;;) {
  const d = await qonto(
    `/transactions?iban=${IBAN}&status[]=completed&side=credit` +
    `&settled_at_from=${from}&settled_at_to=${to}` +
    `&sort_by=settled_at:asc&per_page=100&current_page=${page}`
  )
  all.push(...(d.transactions || []))
  if (!d.meta || !d.meta.next_page) break
  page = d.meta.next_page
}

// Agrégats
const parMois = {}
let total = 0
for (const tx of all) {
  const mois = (tx.settled_at || '').substring(0, 7)
  const montant = Number(tx.amount) || 0
  total += montant
  if (!parMois[mois]) parMois[mois] = { n: 0, sum: 0 }
  parMois[mois].n++
  parMois[mois].sum += montant
}

const fmt = (n) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
console.log(`\n💰 ENCAISSEMENTS QONTO ${YEAR} (crédits complétés, IBAN ...${IBAN.slice(-4)})\n`)
for (const mois of Object.keys(parMois).sort()) {
  console.log(`  ${mois}  ${String(parMois[mois].n).padStart(3)} virements  ${fmt(parMois[mois].sum).padStart(14)}`)
}
console.log(`\n  TOTAL ${YEAR} : ${fmt(total)}  (${all.length} transactions)\n`)

// Top 10 des plus gros encaissements
const top = [...all].sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 10)
console.log('  Top 10 :')
for (const tx of top) {
  const label = (tx.label || tx.reference || '?').substring(0, 45)
  console.log(`   ${(tx.settled_at || '').substring(0, 10)}  ${fmt(Number(tx.amount)).padStart(13)}  ${label}`)
}
