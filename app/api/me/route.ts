import { NextResponse } from 'next/server'
import { getCurrentCommercial } from '@/lib/get-commercial'

export async function GET() {
  const commercial = await getCurrentCommercial()
  if (!commercial) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  return NextResponse.json(commercial)
}
