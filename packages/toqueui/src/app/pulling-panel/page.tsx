import React from 'react';
import AppLayout from '@/components/AppLayout';
import PullingPanelContent from './components/PullingPanelContent';

export default function PullingPanelPage() {
  return (
    <AppLayout activeRoute="/pulling-panel">
      <PullingPanelContent />
    </AppLayout>
  );
}
