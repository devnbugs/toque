"use client"

import { useEffect, useState } from "react"

type Service = { name: string; description: string; action: string }

const services: Service[] = [
  { name: "Health check", description: "Inspect the Worker and browser container status.", action: "health" },
  { name: "Pull context", description: "Load the current authenticated entity and session state.", action: "pull" },
  { name: "Groups", description: "List available Nusuk request groups.", action: "groups" },
  { name: "Named request", description: "Run a catalogued request through the browser session.", action: "request" },
]

export default function Home() {
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState("")
  const [apiKey, setApiKey] = useState("")

  useEffect(() => {
    const saved = window.sessionStorage.getItem("toque-api-key")
    if (saved) setApiKey(saved)
  }, [])

  async function run(action: string) {
    setLoading(action)
    window.sessionStorage.setItem("toque-api-key", apiKey)
    try {
      const response = await fetch(`/api/toque/${action}`, {
        headers: apiKey ? { "X-API-Key": apiKey } : undefined,
      })
      setResult(await response.json())
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Request failed" })
    } finally {
      setLoading("")
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">T</span><span>toque</span></div>
        <nav><a className="active" href="#overview">Overview</a><a href="#services">Services</a><a href="#activity">Activity</a></nav>
        <div className="sidebar-foot"><span className="status-dot" /> Gateway connected</div>
      </aside>
      <section className="content">
        <header className="topbar"><div><p className="eyebrow">OPERATIONS CONSOLE</p><h1>Control room</h1></div><div className="connection"><span className="status-dot" /> Production gateway</div></header>
        <section id="overview" className="hero"><div><p className="eyebrow">NUSUK SERVICE LAYER</p><h2>Everything you need to operate Toque.</h2><p className="lede">A focused workspace for authenticated requests, browser sessions, and service health.</p></div><div className="hero-orbit"><span>TOQUE</span><b>READY</b></div></section>
        <section className="grid" aria-label="Service summary"><div className="metric"><span>Gateway</span><strong>Online</strong><small>Worker responding</small></div><div className="metric"><span>Browser session</span><strong>Standby</strong><small>CloakBrowser container</small></div><div className="metric"><span>Request catalog</span><strong>Ready</strong><small>Named operations available</small></div></section>
        <section id="services" className="section"><div className="section-heading"><div><p className="eyebrow">QUICK ACTIONS</p><h3>Service operations</h3></div><label className="key-field"><span>API key</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Optional" /></label></div><div className="service-grid">{services.map((service, index) => <article className="service-card" key={service.action}><div className="service-number">0{index + 1}</div><h4>{service.name}</h4><p>{service.description}</p><button onClick={() => run(service.action)} disabled={loading !== ""}>{loading === service.action ? "Running…" : "Run operation →"}</button></article>)}</div></section>
        <section id="activity" className="activity"><div><p className="eyebrow">LAST RESPONSE</p><h3>Activity stream</h3></div><pre>{result ? JSON.stringify(result, null, 2) : "Run an operation to see a structured response here."}</pre></section>
      </section>
    </main>
  )
}
