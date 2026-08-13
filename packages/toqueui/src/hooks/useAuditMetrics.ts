'use client';

import { useEffect, useState, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface AuditMetrics {
  successRate: number | null;
  errorCount: number;
  throughput: number; // sends per minute
  isLoading: boolean;
}

const ERROR_ACTIONS = ['error', 'fail', 'denied', 'reject', 'unauthorized', 'forbidden'];

function isErrorAction(action: string): boolean {
  const lower = action.toLowerCase();
  return ERROR_ACTIONS.some((keyword) => lower.includes(keyword));
}

export function useAuditMetrics(): AuditMetrics {
  const [metrics, setMetrics] = useState<AuditMetrics>({
    successRate: null,
    errorCount: 0,
    throughput: 0,
    isLoading: true,
  });

  // Keep a rolling window of recent logs (last 5 minutes)
  const logsRef = useRef<{ action: string; created_at: string }[]>([]);

  const computeMetrics = (logs: { action: string; created_at: string }[]) => {
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const oneMinuteAgo = now - 60 * 1000;

    const recentLogs = logs.filter((l) => new Date(l.created_at).getTime() >= fiveMinutesAgo);

    const total = recentLogs.length;
    const errors = recentLogs.filter((l) => isErrorAction(l.action)).length;
    const successes = total - errors;

    const lastMinuteLogs = recentLogs.filter(
      (l) => new Date(l.created_at).getTime() >= oneMinuteAgo
    );

    setMetrics({
      successRate: total > 0 ? Math.round((successes / total) * 100) : null,
      errorCount: errors,
      throughput: lastMinuteLogs.length,
      isLoading: false,
    });
  };

  useEffect(() => {
    const supabase = createClient();
    let isMounted = true;

    // Initial fetch: last 5 minutes of audit logs
    const fetchInitial = async () => {
      const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('audit_logs')
        .select('action, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(500);

      if (!isMounted) return;

      if (!error && data) {
        logsRef.current = data;
        computeMetrics(data);
      } else {
        setMetrics((prev) => ({ ...prev, isLoading: false }));
      }
    };

    fetchInitial();

    // Real-time subscription for new inserts
    const channel = supabase
      .channel('audit_logs_metrics')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'audit_logs' },
        (payload) => {
          if (!isMounted) return;
          const newLog = payload.new as { action: string; created_at: string };
          // Prepend new log and trim to 5-minute window
          const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
          logsRef.current = [
            newLog,
            ...logsRef.current.filter((l) => new Date(l.created_at).getTime() >= fiveMinutesAgo),
          ];
          computeMetrics(logsRef.current);
        }
      )
      .subscribe();

    // Refresh metrics every 30s to keep throughput window accurate
    const interval = setInterval(() => {
      if (isMounted) computeMetrics(logsRef.current);
    }, 30_000);

    return () => {
      isMounted = false;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  return metrics;
}
