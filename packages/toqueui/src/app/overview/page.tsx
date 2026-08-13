import React from 'react';
import AppLayout from '@/components/AppLayout';
import OverviewContent from './components/OverviewContent';

export default function OverviewPage() {
  return (
    <AppLayout activeRoute="/overview">
      <OverviewContent />
    </AppLayout>
  );
}
