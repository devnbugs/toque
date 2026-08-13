import React from 'react';
import AppLayout from '@/components/AppLayout';
import ApiBuilderContent from './components/ApiBuilderContent';

export default function ApiBuilderPage() {
  return (
    <AppLayout activeRoute="/api-builder">
      <ApiBuilderContent />
    </AppLayout>
  );
}
