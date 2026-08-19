import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

// Environnement de facturation visible dans le CRM.
// 'prod' toujours — le paramètre ?env=test n'est accepté qu'en dev local
// (garde-fou codé en dur : jamais de bascule possible en production).
export function envFacturation(req: NextRequest): 'prod' | 'test' {
  if (process.env.NODE_ENV !== 'production') {
    const e = new URL(req.url).searchParams.get('env')
    if (e === 'test') return 'test'
  }
  return 'prod'
}

export function admin() {
  return createAdminClient()
}

export type Paiement = {
  montant: number
  moyen: string
  date_paiement: string
  reference: string | null
  note: string | null
}

export const MOYENS_LABELS: Record<string, string> = {
  cheque: 'Chèque',
  especes: 'Espèces',
  cb_monetico: 'Carte bancaire',
  virement: 'Virement',
}

// Somme sûre en centimes (évite les flottants qui traînent)
export function somme(nums: number[]): number {
  return Math.round(nums.reduce((s, n) => s + Math.round(Number(n || 0) * 100), 0)) / 100
}

// CSV : BOM UTF-8 + séparateur ';' (convention Excel FR)
export function csvResponse(nomFichier: string, lignes: (string | number | null)[][]): Response {
  const esc = (v: string | number | null) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const corps = '﻿' + lignes.map((l) => l.map(esc).join(';')).join('\r\n')
  return new Response(corps, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nomFichier}"`,
    },
  })
}
