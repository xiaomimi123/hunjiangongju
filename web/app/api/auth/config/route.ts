import { NextResponse } from 'next/server'
import { handler } from '@/lib/api'
import { emailEnabled } from '@/lib/mailer'
import { registrationOpen } from '@/lib/registration'

export const GET = handler(async () => {
  return NextResponse.json({ emailEnabled: await emailEnabled(), registrationOpen: await registrationOpen() })
})
