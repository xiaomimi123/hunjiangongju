import { NextResponse } from 'next/server'
import { CAPABILITIES, testCapability, type Capability } from '@mixcut/db'
import { requireRole, HttpError } from '@/lib/auth'
import { handler } from '@/lib/api'

export const POST = handler(async (_req, { params }) => {
  await requireRole('operator')
  const cap = params.capability
  if (!(CAPABILITIES as string[]).includes(cap)) throw new HttpError(404, '未知能力')
  const r = await testCapability(cap as Capability)
  return NextResponse.json(r)
})
