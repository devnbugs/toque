import { NextRequest, NextResponse } from "next/server"

const allowed = new Set(["health", "pull", "groups", "request"])

export async function GET(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params
  if (!allowed.has(action)) return NextResponse.json({ error: "Unsupported operation" }, { status: 404 })
  const upstream = process.env.TOQUE_WORKER_URL
  if (!upstream) return NextResponse.json({ error: "TOQUE_WORKER_URL is not configured" }, { status: 503 })
  const target = new URL(`/${action}`, upstream)
  const headers = new Headers()
  const apiKey = request.headers.get("x-api-key")
  if (apiKey) headers.set("x-api-key", apiKey)
  try {
    const response = await fetch(target, { headers, cache: "no-store" })
    const body = await response.text()
    return new NextResponse(body, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json" } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gateway unavailable" }, { status: 502 })
  }
}
