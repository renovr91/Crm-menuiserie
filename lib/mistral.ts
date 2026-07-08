/**
 * Mistral AI client.
 * - Voxtral for audio transcription
 * - Mistral Small for summarization + structured extraction
 *
 * Used server-side only.
 */

const MISTRAL_API = 'https://api.mistral.ai/v1'
const VOXTRAL_MODEL = 'voxtral-mini-2507'
const SUMMARY_MODEL = 'mistral-small-latest'

function apiKey(): string {
  const k = process.env.MISTRAL_API_KEY
  if (!k) throw new Error('MISTRAL_API_KEY not set')
  return k
}

export interface TranscribeResult {
  text: string // transcription brute (une seule chaîne)
  diarized: string // transcription avec locuteurs (speaker_1: ... / speaker_2: ...)
  segments: { speaker: string; text: string }[] // tours de parole regroupés par locuteur
  duration_s: number
  model: string
}

/**
 * Transcribe an audio buffer using Voxtral (Mistral), avec séparation des locuteurs.
 * Returns the French transcription (brute + diarisée).
 */
export async function transcribeAudio(audio: Buffer, filename: string): Promise<TranscribeResult> {
  const fd = new FormData()
  fd.append('file', new Blob([new Uint8Array(audio)]), filename)
  fd.append('model', VOXTRAL_MODEL)
  fd.append('language', 'fr')
  fd.append('diarize', 'true')
  fd.append('timestamp_granularities', 'segment')

  const r = await fetch(`${MISTRAL_API}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: fd,
  })
  if (!r.ok) throw new Error(`Voxtral ${r.status}: ${await r.text()}`)
  const data = await r.json()

  // Regroupe les segments consécutifs d'un même locuteur en tours de parole
  const rawSegments: { text?: string; speaker_id?: string }[] = data.segments || []
  const segments: { speaker: string; text: string }[] = []
  for (const s of rawSegments) {
    const txt = (s.text || '').trim()
    if (!txt) continue
    const speaker = s.speaker_id || 'speaker_1'
    const last = segments[segments.length - 1]
    if (last && last.speaker === speaker) last.text += ' ' + txt
    else segments.push({ speaker, text: txt })
  }
  const diarized = segments.map((g) => `${g.speaker}: ${g.text}`).join('\n')

  return {
    text: data.text || '',
    diarized: diarized || data.text || '',
    segments,
    duration_s: data.usage?.prompt_audio_seconds || 0,
    model: VOXTRAL_MODEL,
  }
}

export interface ExtractedData {
  name: string | null
  city: string | null
  zip_code: string | null
  phone: string | null
  email: string | null
  product_type: string | null
  quantity: number | null
  estimated_amount: string | null
  urgency: string | null
  next_action: string | null
}

export interface SummarizeResult {
  summary: string
  extracted: ExtractedData
  client_speaker: string | null // "speaker_1" | "speaker_2" | null — lequel est le client
  model: string
}

const EMPTY_EXTRACTED: ExtractedData = {
  name: null,
  city: null,
  zip_code: null,
  phone: null,
  email: null,
  product_type: null,
  quantity: null,
  estimated_amount: null,
  urgency: null,
  next_action: null,
}

/**
 * Summarize an LBC call transcript and extract structured client data.
 * Designed for Renov-R (menuiseries: fenêtres, portes de garage, volets).
 */
export async function summarizeAndExtract(transcript: string): Promise<SummarizeResult> {
  const prompt = `Tu es un assistant qui analyse des appels téléphoniques pour Renov-R (entreprise de menuiseries : fenêtres PVC/alu, portes de garage, volets roulants).

Voici la transcription d'un appel téléphonique :
"""
${transcript}
"""

La transcription peut être séparée par locuteurs (speaker_1, speaker_2). Renov-R est l'entreprise (celle qui décroche / propose ses services), le CLIENT est celui qui appelle ou demande un devis.

Tâche : extraire les informations clients pertinentes au format JSON STRICT (pas de texte autour) selon ce schéma :
{
  "summary": "résumé en 2-3 phrases en français",
  "client_speaker": "si la transcription a des locuteurs, indique lequel est le CLIENT: 'speaker_1' ou 'speaker_2', sinon null",
  "extracted": {
    "name": "nom du client si mentionné, sinon null",
    "city": "ville si mentionnée, sinon null",
    "zip_code": "code postal sur 5 chiffres si mentionné, sinon null",
    "phone": "numéro de téléphone si mentionné, sinon null",
    "email": "email si mentionné, sinon null",
    "product_type": "type de produit (fenetre, porte_garage, volet, autre), sinon null",
    "quantity": "nombre d'éléments si mentionné, sinon null",
    "estimated_amount": "montant ou fourchette si mentionné (ex: '3000€', '4000-5000€'), sinon null",
    "urgency": "haute, moyenne, basse si déduisible, sinon null",
    "next_action": "prochaine étape mentionnée (ex: 'envoyer devis', 'rappeler jeudi'), sinon null"
  }
}

IMPORTANT : réponds UNIQUEMENT avec le JSON valide, rien d'autre.`

  const r = await fetch(`${MISTRAL_API}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  })
  if (!r.ok) throw new Error(`Mistral chat ${r.status}: ${await r.text()}`)
  const data = await r.json()
  const content = data.choices?.[0]?.message?.content || '{}'

  let parsed: { summary?: string; extracted?: Partial<ExtractedData>; client_speaker?: string }
  try {
    parsed = JSON.parse(content)
  } catch {
    return {
      summary: 'Résumé IA non disponible (parsing JSON échoué).',
      extracted: { ...EMPTY_EXTRACTED },
      client_speaker: null,
      model: SUMMARY_MODEL,
    }
  }

  return {
    summary: parsed.summary || '',
    extracted: { ...EMPTY_EXTRACTED, ...(parsed.extracted || {}) },
    client_speaker: parsed.client_speaker || null,
    model: SUMMARY_MODEL,
  }
}

/**
 * Parse an estimated amount string from extracted data into a number.
 *  - "3000€"          -> 3000
 *  - "3000-5000€"     -> 4000 (average)
 *  - "environ 4000"   -> 4000
 *  - "4 000 euros"    -> 4000
 *  - null / unparseable -> null
 */
export function parseAmount(amount: string | null | undefined): number | null {
  if (!amount) return null
  const cleaned = amount.replace(/[€\s]/g, '').toLowerCase()
  const range = cleaned.match(/(\d+)[-/](\d+)/)
  if (range) return Math.round((parseInt(range[1], 10) + parseInt(range[2], 10)) / 2)
  const single = cleaned.match(/(\d+)/)
  if (single) return parseInt(single[1], 10)
  return null
}
