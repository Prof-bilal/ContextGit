import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import TeamPrototype from './ui';
import { createMockAdapter } from './model';
import './prototype.css';

const adapter = createMockAdapter(window.localStorage);
createRoot(document.getElementById('root')!).render(<StrictMode><TeamPrototype adapter={adapter} /></StrictMode>);
