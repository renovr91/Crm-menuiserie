import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { message } = await request.json()
  if (!message || typeof message !== 'string') {
    return NextResponse.json({ error: 'Message requis' }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY manquante' }, { status: 500 })
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Extrais les informations de contact de ce message client. Réponds UNIQUEMENT en JSON valide, sans texte autour. Si un champ n'est pas trouvé, mets null.

Format attendu:
{"nom": "...", "telephone": "...", "email": "...", "adresse": "...", "code_postal": "...", "ville": "...", "besoin": "...", "source": "leboncoin|email|telephone|autre"}

Message:
${message}`
      }],
    }),
  })

  if (!resp.ok) {
    return NextResponse.json({ error: 'Erreur API IA' }, { status: 500 })
  }

  const result = await resp.json()
  const text = result.content?.[0]?.text || '{}'

  try {
    const extracted = JSON.parse(text)
    return NextResponse.json(extracted)
  } catch {
    return NextResponse.json({ error: 'Réponse IA invalide', raw: text }, { status: 500 })
  }
}
