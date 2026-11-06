import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PrivateKeyDetail } from './components/PrivateKeyDetail';

import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).get('detail') === 'key' ? <PrivateKeyDetail /> : <App />}
  </StrictMode>,
);
