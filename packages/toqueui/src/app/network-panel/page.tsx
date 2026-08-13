import React from 'react';
import AppLayout from '@/components/AppLayout';
import NetworkPanelContent from './components/NetworkPanelContent';

export default function NetworkPanelPage() {
  return (
    <AppLayout activeRoute="/network-panel">
      <NetworkPanelContent />
    </AppLayout>
  );
}
