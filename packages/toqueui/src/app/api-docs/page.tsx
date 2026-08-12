"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getHealth, listCommands } from "@/lib/api";
import { PageHeader, Card, LoadingState, ErrorState, Tag } from "@/components/ui";

const API_CATEGORIES = [
  {
    title: "Health & Discovery",
    items: [
      { method: "GET", path: "/health", auth: false, desc: "Public health check" },
      { method: "GET", path: "/help", auth: true, desc: "Full API documentation from the container" },
    ],
  },
  {
    title: "Authentication Context",
    items: [
      { method: "POST", path: "/pull", auth: true, desc: "Pull fresh auth, entity, and CAPTCHA context" },
      { method: "POST", path: "/login", auth: true, desc: "Auto-login via CAPTCHA solver and save JWT" },
      { method: "POST", path: "/verify-login", auth: true, desc: "Verify OTP after auto-login" },
      { method: "POST", path: "/refresh-token", auth: true, desc: "Refresh JWT using stored refresh token" },
    ],
  },
  {
    title: "Nusuk Operations",
    items: [
      { method: "POST", path: "/info", auth: true, desc: "Fetch dashboard company info" },
      { method: "POST", path: "/send", auth: true, desc: "Send a visa request for a group" },
      { method: "POST", path: "/api", auth: true, desc: "Run a saved request from the catalog" },
      { method: "POST", path: "/request", auth: true, desc: "Send a custom API request to any Nusuk path" },
      { method: "POST", path: "/groups", auth: true, desc: "List groups with pagination" },
      { method: "POST", path: "/schedule", auth: true, desc: "Schedule a timed visa request" },
    ],
  },
  {
    title: "Pool & Performance",
    items: [
      { method: "POST", path: "/warm", auth: true, desc: "Pre-warm Nusuk browser instances" },
      { method: "POST", path: "/pool-status", auth: true, desc: "Show warmed instance pool status" },
    ],
  },
  {
    title: "CAPTCHA",
    items: [
      { method: "POST", path: "/captcha/solve", auth: true, desc: "Solve a CAPTCHA via CapSolver/CapMonster" },
      { method: "POST", path: "/captcha/balance", auth: true, desc: "Check solver account balance" },
    ],
  },
  {
    title: "CLI Proxy",
    items: [
      { method: "POST", path: "/cmd", auth: true, desc: "Run any CLI command via JSON" },
      { method: "GET", path: "/cmd/list", auth: true, desc: "List available CLI commands" },
    ],
  },
  {
    title: "Workflows",
    items: [
      { method: "POST", path: "/schedule/workflow", auth: true, desc: "Create durable scheduled send" },
      { method: "GET", path: "/schedule/workflow/status", auth: true, desc: "Check workflow status" },
      { method: "POST", path: "/schedule/workflow/terminate", auth: true, desc: "Terminate a workflow" },
    ],
  },
];

export default function ApiDocsPage() {
  const { user, loading: authLoading } = useAuth();
  const [health, setHealth] = useState<{ ok: boolean } | null>(null);
  const [commands, setCommands] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [h, cmdList] = await Promise.all([
          getHealth().catch(() => ({ ok: false })),
          listCommands().catch(() => ({ ok: false, commands: [] })),
        ]);
        setHealth(h);
        setCommands((cmdList.commands || []).map((c) => typeof c === "string" ? c : (c as { name: string }).name));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (authLoading) return <LoadingState message="Authenticating…" />;
  if (!user) return <ErrorState message="Please sign in via Cloudflare Access." />;

  return (
    <div>
      <PageHeader
        title="API Documentation"
        subtitle="Toque Worker and container endpoints"
      />

      <Card className="mb-6">
        <div className="flex items-center gap-3">
          <Tag variant={health?.ok ? "green" : "red"}>{health?.ok ? "Online" : "Offline"}</Tag>
          <span style={{ color: "var(--text-dim)" }}>
            Base URL: <code>https://toque.decloud.workers.dev</code>
          </span>
        </div>
        <p className="mt-2" style={{ color: "var(--text-dim)" }}>
          All endpoints except <code>/health</code> require Cloudflare Access JWT
          or an <code>X-API-Key</code> header matching the <code>TOQUE_API_KEY</code> secret.
        </p>
      </Card>

      {loading ? (
        <LoadingState message="Loading docs…" />
      ) : (
        <div className="space-y-6">
          {API_CATEGORIES.map((category) => (
            <Card key={category.title}>
              <h3 className="page-title mb-4" style={{ fontSize: 18 }}>{category.title}</h3>
              <div className="api-docs-list">
                {category.items.map((item) => (
                  <div key={item.path} className="api-docs-item">
                    <div className="api-docs-row">
                      <Tag variant="blue">{item.method}</Tag>
                      <code className="api-docs-path">{item.path}</code>
                      {item.auth ? <Tag variant="yellow">auth</Tag> : <Tag variant="green">public</Tag>}
                    </div>
                    <p className="api-docs-desc">{item.desc}</p>
                  </div>
                ))}
              </div>
            </Card>
          ))}

          <Card>
            <h3 className="page-title mb-4" style={{ fontSize: 18 }}>CLI Commands</h3>
            <div className="command-grid">
              {commands.map((name) => (
                <code key={name} className="command-pill">{name}</code>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
