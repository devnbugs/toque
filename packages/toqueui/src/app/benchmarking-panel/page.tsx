import React from 'react';
import AppLayout from '@/components/AppLayout';
import BenchmarkingPanelContent from './components/BenchmarkingPanelContent';
import RoleGuard from '@/components/RoleGuard';

export default function BenchmarkingPanelPage() {
  return (
    <AppLayout activeRoute="/benchmarking-panel">
      <RoleGuard panel="benchmarking">
        <BenchmarkingPanelContent />
      </RoleGuard>
    </AppLayout>
  );
}
