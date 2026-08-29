import { redirect } from 'next/navigation'

// L'onglet s'appelle « Factures » depuis le 29/08/2026 : « Compta » laissait
// croire à de la comptabilité générale alors qu'on y gère des documents de
// facturation. Redirection conservée pour les liens déjà en circulation.
export default function ComptaRedirection() {
  redirect('/factures')
}
