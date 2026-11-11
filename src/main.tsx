import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { IllnanPage } from './components/IllnanPage';
import { MnemonicDetail } from './components/MnemonicDetail';
import { PrivateKeyDetail } from './components/PrivateKeyDetail';

import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

const params = new URLSearchParams(window.location.search);
const view = params.get('view');
const isIllnan = view === 'ill-nan' || view === 'illnan';
createRoot(container).render(
  <StrictMode>
    {isIllnan ? <IllnanPage /> : params.get('detail') === 'key' ? <PrivateKeyDetail /> : params.get('detail') === 'mnemonic' ? <MnemonicDetail /> : <App />}
  </StrictMode>,
);
