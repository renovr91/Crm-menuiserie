import { NextRequest, NextResponse } from 'next/server'
import { getRecentActivity, logActivity, ActionType, EntityType } from '@/lib/activity-log'
import { getCurrentCommercial } from '@/lib/get-commercial'

export async function GET(request: NextRequest) {
  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '50')
  const data = await getRecentActivity(limit)
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const commercial = await getCurrentCommercial()
  if (!commercial) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }

  const body = await request.json()
  await logActivity({
    commercial_id: commercial.id,
    user_id: commercial.user_id,
    action_type: body.action_type as ActionType,
    entity_type: body.entity_type as EntityType,
    entity_id: body.entity_id,
    details: body.details || {},
  })

  return NextResponse.json({ ok: true })
}
