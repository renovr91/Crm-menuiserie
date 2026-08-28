import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { listerReponses, supprimerReponse } from '@/lib/ovh-sms'

export const dynamic = 'force-dynamic'

/**
 * Rapatrie les réponses SMS des clients depuis OVH vers la base.
 *
 * Pourquoi une relève et pas un webhook : OVH n'appelle une URL de callback
 * que si le service est configuré pour, et cette URL doit rester publique.
 * Une relève déclenchée à l'ouverture de la page (et par cron) évite d'exposer
 * un endpoint de plus, pour un délai qui reste négligeable ici.
 *
 * Les réponses sont supprimées côté OVH après enregistrement : leur file
 * n'est pas un historique, on ne veut pas la relire indéfiniment.
 */
export async function GET() {
  const supabase = createAdminClient()
  let recues = 0

  try {
    const reponses = await listerReponses()
    for (const r of reponses) {
      const { error } = await supabase.from('sms_recus').upsert(
        {
          id: r.id,
          telephone: r.sender,
          message: r.message,
          tag: r.tag || null,
          recu_le: r.creationDatetime,
        },
        { onConflict: 'id' },
      )
      if (!error) {
        recues++
        // Purge côté OVH seulement si l'enregistrement a réussi :
        // en cas d'échec base, la réponse reste récupérable au passage suivant.
        await supprimerReponse(r.id).catch(() => {})
      }
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'relève OVH impossible' },
      { status: 502 },
    )
  }

  const { data } = await supabase
    .from('sms_recus')
    .select('*')
    .order('recu_le', { ascending: false })
    .limit(50)

  return NextResponse.json({ ok: true, nouvelles: recues, reponses: data || [] })
}
