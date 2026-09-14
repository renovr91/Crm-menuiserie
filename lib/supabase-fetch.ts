// Relance des LECTURES coupées par la passerelle Supabase.
// Depuis le 12/09/2026 00:00 UTC, la passerelle « v2 » renvoie un 504 au bout
// de ~5 s sur ~10 % des requêtes (82/818 sur 24 h, toutes tables, base au repos ;
// l'ancienne passerelle v1 : 0 sur la même période). Une nouvelle tentative
// passe. On ne relance que GET/HEAD : une écriture coupée a pu être appliquée,
// la rejouer créerait un doublon (numéro de devis, lead, facture…).
const STATUTS_RELANCABLES = new Set([502, 503, 504])
const ATTENTES_MS = [300, 900]

export const fetchAvecRelance: typeof fetch = async (input, init) => {
  const methode = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (methode !== 'GET' && methode !== 'HEAD') return fetch(input, init)

  let reponse = await fetch(input, init)
  for (const attente of ATTENTES_MS) {
    if (!STATUTS_RELANCABLES.has(reponse.status) || init?.signal?.aborted) break
    await new Promise((r) => setTimeout(r, attente))
    reponse = await fetch(input, init)
  }
  return reponse
}
