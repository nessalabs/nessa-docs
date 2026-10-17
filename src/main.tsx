import { applyLanguage, readLanguage } from './i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { createHttpProjectSource } from './api';
import { App } from './app';
import { applyAppearance, readAppearance } from './appearance';
import { recordClientEntry } from './build';
import './styles.css';

recordClientEntry(import.meta.url);
applyAppearance(readAppearance());
applyLanguage(readLanguage());

const source = createHttpProjectSource(window.fetch.bind(window));
const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App source={source} />
    </StrictMode>,
  );
}
