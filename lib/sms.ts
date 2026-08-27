/**
 * Envoi de SMS — façade sur lib/ovh-sms.ts.
 *
 * ⚠️ Cette lib contenait auparavant une SECONDE implémentation OVH qui lisait
 * des variables inexistantes en production (OVH_SMS_APP_KEY, OVH_SMS_APP_SECRET,
 * OVH_SMS_CONSUMER_KEY, OVH_SMS_SERVICE_NAME) : tous les SMS envoyés par
 * /api/devis échouaient silencieusement. Elle déléguait aussi à un expéditeur
 * « Renov-R » codé en dur, non déclaré côté opérateur.
 *
 * Une seule implémentation subsiste désormais (ovh-sms.ts), avec l'expéditeur
 * piloté par OVH_SMS_SENDER — il doit être un numéro MOBILE validé dans
 * l'espace OVH pour que le client puisse répondre.
 */

import { sendNotifSMS } from './ovh-sms'

export async function envoyerSMS(
  telephone: string,
  message: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await sendNotifSMS(telephone, message)
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'erreur SMS inconnue' }
  }
}
