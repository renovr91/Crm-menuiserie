import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

/**
 * GET /api/leads-partenaire?limit=300
 * Vue LECTURE SEULE pour la page /leads-partenaire : chaque lead reçu du
 * partenaire, avec le devis lié (montant, marge, PDF) et si l'affaire est
 * SIGNÉE — même dérivation que `commissions_apporteur` (commandes.stage),
 * une seule vérité entre la page et le calcul de commission.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '300', 10), 1), 1000)

    const supabase = createAdminClient()
    const { data: leads, error } = await supabase
      .from('leads_partenaire')
      .select('id, created_at, nom, telephone, email, adresse, code_postal, ville, type_porte, dimensions, message, devis_numero, statut, note, note_relance, envoi_statut, envoye_le, envoi_erreur, envoi_bloque, envoi_mode, sms_statut, sms_envoye_le, sms_erreur')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const numeros = (leads || []).map((l) => l.devis_numero).filter((n): n is string => !!n)

    const devisParNumero: Record<string, {
      montant_ht: number | null; montant_ttc: number | null; marge_ht: number | null
      pdf_path: string | null; reference: string | null
    }> = {}
    const stageParNumero: Record<string, string> = {}

    if (numeros.length) {
      const [{ data: devisRows }, { data: commandeRows }] = await Promise.all([
        supabase.from('devis_claudus')
          .select('numero, montant_ht, montant_ttc, marge_ht, pdf_path, reference')
          .in('numero', numeros),
        supabase.from('commandes').select('devis_numero, stage').in('devis_numero', numeros),
      ])
      for (const d of devisRows || []) {
        devisParNumero[d.numero] = {
          montant_ht: d.montant_ht, montant_ttc: d.montant_ttc, marge_ht: d.marge_ht,
          pdf_path: d.pdf_path, reference: d.reference,
        }
      }
      for (const c of commandeRows || []) {
        if (c.devis_numero) stageParNumero[c.devis_numero] = c.stage
      }
    }

    // Même liste de stages que commissions_apporteur (app/api/agent/route.ts) :
    // une SEULE définition de « signé », sinon la page et la commission
    // finissent par se contredire sur la même affaire.
    const SIGNE = new Set(['signe', 'a_commander', 'commandee', 'livree', 'posee', 'payee', 'terminee'])

    const lignes = (leads || []).map((l) => {
      const num = l.devis_numero
      const devis = num ? devisParNumero[num] : undefined
      const stage = num ? stageParNumero[num] || null : null
      return {
        id: l.id,
        created_at: l.created_at,
        nom: l.nom, telephone: l.telephone, email: l.email,
        adresse: l.adresse, code_postal: l.code_postal, ville: l.ville,
        type_porte: l.type_porte, dimensions: l.dimensions, message: l.message,
        devis_numero: num,
        devis_montant_ht: devis?.montant_ht ?? null,
        devis_montant_ttc: devis?.montant_ttc ?? null,
        devis_marge_ht: devis?.marge_ht ?? null,
        devis_pdf: !!devis?.pdf_path,
        // Statut normalisé pour l'UI : le backfill n'a pu poser 'bloque' que
        // rétroactivement — un lead jamais repassé en veille reste 'nouveau'.
        statut: num ? 'devis_genere' : (l.statut === 'bloque' ? 'bloque' : 'nouveau'),
        signe: !!stage && SIGNE.has(stage),
        stage,
        note: l.note,
        note_relance: l.note_relance,
        envoi_statut: l.envoi_statut,
        envoye_le: l.envoye_le,
        envoi_erreur: l.envoi_erreur,
        envoi_bloque: !!l.envoi_bloque,
        envoi_mode: l.envoi_mode,
        sms_statut: l.sms_statut,
        sms_envoye_le: l.sms_envoye_le,
        sms_erreur: l.sms_erreur,
      }
    })

    return NextResponse.json(lignes)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
