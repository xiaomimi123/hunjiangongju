import { NextRequest, NextResponse } from 'next/server'
import { HttpError } from './auth'

type Handler = (req: NextRequest, ctx: { params: Record<string, string> }) => Promise<Response>

export function handler(fn: Handler): Handler {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx)
    } catch (e) {
      if (e instanceof HttpError) {
        return NextResponse.json({ error: e.message }, { status: e.status })
      }
      console.error(e)
      return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
    }
  }
}
