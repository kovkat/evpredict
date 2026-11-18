import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

createRoot(document.getElementById('root')!, {
  onCaughtError: () => undefined,
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
