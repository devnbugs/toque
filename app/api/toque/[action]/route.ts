import { NextRequest, NextResponse } from "next/server"

const operations: Record<string, { method: "GET" | "POST"; path: string }> = {
  health: { method: "GET", path: "/health" },
  pull: { method: "POST", path: "/pull" },
  groups: { method: "POST", path: "/groups" },
  request: { method: "POST", path: "/api" },
}

export async function GET(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  return forward(request, context, "GET")
}

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  return forward(request, context, "POST")
}

async function forward(request: NextRequest, context: { params: Promise<{ action: string }> }, method: "GET" | "POST") {
  const { action } = await context.params
  const operation = operations[action]
  if (!operation || operation.method !== method) {
    return NextResponse.json({ ok: false, error: `Unsupported ${method} operation: ${action}` }, { status: 405 })
  }

  const upstream = process.env.TOQUE_WORKER_URL
  if (!upstream) return NextResponse.json({ ok: false, error: "TOQUE_WORKER_URL is not configured" }, { status: 503 })

  const headers = new Headers({ accept: "application/json" })
  const apiKey = request.headers.get("x-api-key")
  if (apiKey) headers.set("x-api-key", apiKey)
  let body: string | undefined
  if (method === "POST") {
    headers.set("content-type", "application/json")
    body = await request.text()
    if (!body) body = "{}"
  }

  try {
    const response = await fetch(new URL(operation.path, upstream), { method, headers, body, cache: "no-store" })
    const text = await response.text()
    let payload: unknown
    try { payload = JSON.parse(text) } catch { payload = { ok: response.ok, status: response.status, data: text } }
    return NextResponse.json(payload, { status: response.status, headers: { "cache-control": "no-store" } })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Gateway unavailable" }, { status: 502 })
  }
}
