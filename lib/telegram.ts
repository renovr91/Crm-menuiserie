/** Envoi de notifications Telegram (bot Renov-R). */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const CHAT_ID_DEFAUT = process.env.TELEGRAM_CHAT_ID || ''

export async function envoyerTelegram(texte: string, chatId?: string): Promise<boolean> {
  const cible = chatId || CHAT_ID_DEFAUT
  if (!TOKEN || !cible) return false
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cible, text: texte, parse_mode: 'HTML' }),
    })
    return r.ok
  } catch {
    return false
  }
}

/** Message de signature : "✅ DC-00912 signé — Client — 2 729 €" */
export function messageSignature(p: {
  numero: string | null
  client: string | null
  montant: number | null
  titre?: string | null
}): string {
  const montant =
    p.montant != null
      ? Number(p.montant).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
      : null
  const lignes = [
    `✅ <b>Devis signé${p.numero ? ` — ${p.numero}` : ''}</b>`,
    p.client ? `👤 ${p.client}` : null,
    montant ? `💶 ${montant}` : null,
    p.titre ? `📄 ${p.titre}` : null,
  ].filter(Boolean)
  return lignes.join('\n')
}
