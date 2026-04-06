import { NextRequest, NextResponse } from 'next/server'
import { classifyMessage } from '@/lib/classifier'

export async function POST(request: NextRequest) {
  const { titre_annonce, message_client, has_attachment } = await request.json()
  if (!message_client) return NextResponse.json({ error: 'Message requis' }, { status: 400 })

  try {
    const result = await classifyMessage(titre_annonce || '', message_client, has_attachment || false)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Classification error:', error)
    return NextResponse.json({ error: 'Erreur de classification' }, { status: 500 })
  }
}
