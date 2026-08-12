"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { getHealth, getAuthaStats, getAuditStats, listEntities, listCommands } from "@/lib/api";
import { PageHeader, StatCard, Card, Tag, LoadingState, ErrorState, Button } from "@/components/ui";

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const [health, setHealth] = useState<{ ok: boolean } | null>(null);
  const [authaStats, setAuthaStats] = useState<Record<string, unknown> | null>(null);
  const [auditStats, setAuditStats] = useState<Record<string, unknown> | null>(null);
  const [entities, setEntities] = useState<string[]>([]);
  const [commands, setCommands] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [h, as, aus, ent, cmd] = await Promise.all([
          getHealth(),
          getAuthaStats().catch(() => null),
          getAuditStats().catch(() => null),
          listEntities().catch(() => null),
          listCommands().catch(() => null),
        ]);
        setHealth(h);
        setAuthaStats(as);
        setAuditStats(aus);
        setEntities(ent?.entities || []);
        setCommands((cmd?.commands || []).map((c) => typeof c === "string" ? c : (c as { name: string }).name));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (authLoading) return <LoadingState message="Authenticating…" />;
  if (!user) return <ErrorState message="Please sign in via Cloudflare Access." />;

  const tokenCount = (authaStats?.stats as Record<string, unknown>)?.totalRecords as number || 0;
  const auditCount = (auditStats?.stats as Record<string, unknown>)?.totalEvents as number || 0;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Real-time overview of the Toque mesh"
        action={
          <Link href="/api-docs">
            <Button variant="secondary">📚 API Docs</Button>
          </Link>
        }
      />

      {loading ? (
        <LoadingState message="Loading stats…" />
      ) : (
        <>
          <div className="stat-grid">
            <StatCard
              icon={health?.ok ? "✓" : "✕"}
              value={health?.ok ? "Online" : "Offline"}
              label="Worker Status"
              color={health?.ok ? "green" : "red"}
            />
            <StatCard
              icon="◈"
              value={entities.length}
              label="Active Entities"
              color="accent"
            />
            <StatCard
              icon="🔑"
              value={tokenCount}
              label="Stored Tokens"
              color="blue"
            />
            <StatCard
              icon="≡"
              value={auditCount}
              label="Audit Events (5m)"
              color="yellow"
            />
          </div>

          <div className="card-grid mt-6">
            <Card>
              <div className="flex items-center gap-3 mb-2">
                <h3 className="page-title" style={{ fontSize: 18 }}>Welcome, {user.fullName || user.email}</h3>
                <Tag variant="blue">{user.role}</Tag>
              </div>
              <p style={{ color: "var(--text-dim)" }}>
                Use the sidebar to manage entities, audit logs, settings, and team members.
                All data is served via the Cloudflare mesh — Workers, D1, and Containers.
              </p>
            </Card>

            <Card>
              <h3 className="page-title mb-3" style={{ fontSize: 18 }}>Quick Links</h3>
              <div className="flex flex-wrap gap-2">
                <Link href="/entities"><Button variant="secondary">Entities</Button></Link>
                <Link href="/audit"><Button variant="secondary">Audit</Button></Link>
                <Link href="/settings"><Button variant="secondary">Settings</Button></Link>
                <Link href="/users"><Button variant="secondary">Team</Button></Link>
              </div>
            </Card>
          </div>

          <Card className="mt-6">
            <h3 className="page-title mb-3" style={{ fontSize: 18 }}>Available CLI Commands</h3>
            <div className="command-grid">
              {commands.slice(0, 16).map((name) => (
                <code key={name} className="command-pill">{name}</code>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
