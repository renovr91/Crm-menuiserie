import { NextResponse } from 'next/server'
import { admin } from '../_lib'

function eur(v: number) {
  return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function dateFr(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR')
}

// GET /api/compta/impayes — vue factures_impayees (prod uniquement, par
// construction de la vue) + texte de relance prêt à copier.
export async function GET() {
  try {
    const sb = admin()
    const { data, error } = await sb
      .from('factures_impayees')
      .select('*')
      .order('date_echeance', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rows = (data || []).map((r) => {
      const enRetard = Number(r.jours_retard) > 0
      const texte_relance = [
        `Bonjour ${r.client_nom},`,
        '',
        enRetard
          ? `Sauf erreur de notre part, notre facture n° ${r.numero} du ${dateFr(r.emise_le)} d'un montant restant dû de ${eur(Number(r.restant))} est arrivée à échéance le ${dateFr(r.date_echeance)}.`
          : `Petit rappel concernant notre facture n° ${r.numero} du ${dateFr(r.emise_le)} : il reste ${eur(Number(r.restant))} à régler, à échéance du ${dateFr(r.date_echeance)}.`,
        '',
        'Vous pouvez régler par virement (RIB sur la facture), chèque à l\'ordre de RENOV.R ou carte bancaire.',
        'Si votre règlement s\'est croisé avec ce message, merci de ne pas en tenir compte.',
        '',
        'Cordialement,',
        'Mr Senane — RENOV-R 91',
        '📞 01 79 72 52 25',
        '✉️ contact@renov-r.com',
      ].join('\n')
      return { ...r, texte_relance }
    })
    return NextResponse.json(rows)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
