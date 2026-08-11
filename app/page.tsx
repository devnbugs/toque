"use client"

import { useEffect, useState } from "react"
import { Activity, ArrowUpRight, CheckCircle2, CircleAlert, KeyRound, Loader2, RefreshCw, Server, ShieldCheck } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

type Result = { ok?: boolean; status?: number; error?: string; [key: string]: unknown }
type Service = { name: string; description: string; action: string; method: "GET" | "POST"; body?: Record<string, unknown>; icon: typeof Activity }

const services: Service[] = [
  { name: "Health check", description: "Confirm the Worker is reachable without credentials.", action: "health", method: "GET", icon: Activity },
  { name: "Pull context", description: "Refresh authenticated entity and session context.", action: "pull", method: "POST", body: { refresh: true }, icon: RefreshCw },
  { name: "Groups", description: "Load available Nusuk groups from the browser session.", action: "groups", method: "POST", body: { limit: 10 }, icon: Server },
  { name: "Request catalog", description: "Run the saved company-info request through the session.", action: "request", method: "POST", body: { name: "company-info" }, icon: ArrowUpRight },
]

export default function Home() {
  const [result, setResult] = useState<Result | null>(null)
  const [loading, setLoading] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [authenticated, setAuthenticated] = useState(false)

  useEffect(() => {
    const saved = window.sessionStorage.getItem("toque-api-key")
    if (saved) { setApiKey(saved); setAuthenticated(true) }
  }, [])

  async function run(service: Service) {
    setLoading(service.action)
    setResult(null)
    if (apiKey) { window.sessionStorage.setItem("toque-api-key", apiKey); setAuthenticated(true) }
    try {
      const response = await fetch(`/api/toque/${service.action}`, {
        method: service.method,
        headers: apiKey ? { "X-API-Key": apiKey, "Content-Type": "application/json" } : { "Content-Type": "application/json" },
        body: service.method === "POST" ? JSON.stringify(service.body ?? {}) : undefined,
      })
      const payload = await response.json().catch(() => ({ ok: false, error: "Invalid gateway response" }))
      setResult({ ...payload, status: response.status, ok: response.ok && payload.ok !== false })
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : "Request failed" })
    } finally { setLoading("") }
  }

  function clearKey() { setApiKey(""); setAuthenticated(false); window.sessionStorage.removeItem("toque-api-key") }
  const failed = result && result.ok === false

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col lg:flex-row">
        <aside className="flex w-full flex-col border-b border-border p-6 lg:w-64 lg:border-b-0 lg:border-r lg:p-8">
          <div className="flex items-center gap-3 text-xl font-semibold tracking-tight"><span className="grid size-8 place-items-center rounded-md bg-primary font-mono text-sm text-primary-foreground">T</span> toque</div>
          <nav className="mt-10 flex gap-2 overflow-auto lg:mt-20 lg:flex-col"><a className="rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground" href="#overview">Overview</a><a className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted" href="#services">Services</a><a className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted" href="#activity">Activity</a></nav>
          <div className="mt-auto hidden items-center gap-2 pt-8 font-mono text-xs text-muted-foreground lg:flex"><span className={`size-2 rounded-full ${authenticated ? "bg-primary" : "bg-muted-foreground"}`} /> {authenticated ? "API key loaded" : "Read-only mode"}</div>
        </aside>
        <div className="flex-1 p-6 lg:p-10 xl:p-14">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-mono text-[10px] font-medium tracking-[.18em] text-primary">OPERATIONS CONSOLE</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Control room</h1></div><Badge variant={authenticated ? "secondary" : "outline"} className="w-fit gap-2"><span className={`size-2 rounded-full ${authenticated ? "bg-primary" : "bg-muted-foreground"}`} />{authenticated ? "Authenticated" : "Unauthenticated"}</Badge></header>
          <section id="overview" className="mt-12 grid gap-8 rounded-xl border border-border bg-card p-7 lg:grid-cols-[1fr_auto] lg:p-10"><div><p className="font-mono text-[10px] tracking-[.18em] text-primary">NUSUK SERVICE LAYER</p><h2 className="mt-4 max-w-2xl text-4xl font-semibold leading-[1.02] tracking-[-.05em] sm:text-6xl">Operate Toque with clarity.</h2><p className="mt-6 max-w-xl leading-7 text-muted-foreground">Run authenticated requests, refresh browser sessions, and inspect service responses from one focused workspace.</p></div><div className="flex size-36 flex-col items-center justify-center rounded-full border border-primary/50 font-mono text-center text-xs text-primary"><ShieldCheck className="mb-2" /><span>TOQUE</span><strong className="text-foreground">READY</strong></div></section>
          <section className="mt-5 grid gap-4 md:grid-cols-3"><StatusCard label="Gateway" value={result?.status === 200 ? "Online" : "Awaiting check"} note="Worker response status" /><StatusCard label="Session" value={authenticated ? "Key loaded" : "Read-only"} note="API key stays in session" /><StatusCard label="Last result" value={result ? (failed ? "Error" : "Success") : "None"} note={result?.status ? `HTTP ${result.status}` : "No operation yet"} /></section>
          <section id="services" className="mt-14"><div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between"><div><p className="font-mono text-[10px] tracking-[.18em] text-primary">QUICK ACTIONS</p><h3 className="mt-2 text-2xl font-semibold tracking-tight">Service operations</h3></div><div className="flex w-full max-w-sm items-end gap-2"><div className="flex-1"><Label htmlFor="api-key" className="mb-2 block text-xs text-muted-foreground">API key</Label><Input id="api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Optional for health" /></div><Button variant="outline" size="icon" onClick={clearKey} aria-label="Clear API key"><KeyRound /></Button></div></div><div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">{services.map((service, index) => <Card key={service.action} className="bg-card"><CardHeader><div className="flex items-center justify-between"><Badge variant="outline" className="font-mono">0{index + 1}</Badge><service.icon className="text-primary" /></div><CardTitle className="pt-2 text-lg">{service.name}</CardTitle><CardDescription>{service.description}</CardDescription></CardHeader><CardContent><Button className="w-full" variant="secondary" disabled={Boolean(loading)} onClick={() => run(service)}>{loading === service.action ? <><Loader2 className="animate-spin" data-icon="inline-start" />Running</> : "Run operation"}</Button></CardContent></Card>)}</div></section>
          <section id="activity" className="mt-14"><Separator /><div className="mt-8 flex items-center justify-between"><div><p className="font-mono text-[10px] tracking-[.18em] text-primary">LAST RESPONSE</p><h3 className="mt-2 text-2xl font-semibold tracking-tight">Activity stream</h3></div>{result && <Badge variant={failed ? "destructive" : "secondary"}>{failed ? <CircleAlert data-icon="inline-start" /> : <CheckCircle2 data-icon="inline-start" />}{failed ? "Request failed" : "Request complete"}</Badge>}</div>{result && failed && <Alert variant="destructive" className="mt-5"><AlertTitle>Gateway returned an error</AlertTitle><AlertDescription>{result.error ?? `Request failed with HTTP ${result.status ?? "unknown"}.`}</AlertDescription></Alert>}<pre className="mt-5 max-h-96 overflow-auto rounded-lg border border-border bg-muted p-5 font-mono text-xs leading-6 text-muted-foreground">{result ? JSON.stringify(result, null, 2) : "Run an operation to see a structured response here."}</pre></section>
        </div>
      </div>
    </main>
  )
}

function StatusCard({ label, value, note }: { label: string; value: string; note: string }) {
  return <Card className="bg-card"><CardContent className="p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-xl font-semibold">{value}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{note}</p></CardContent></Card>
}
