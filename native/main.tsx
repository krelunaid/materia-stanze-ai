import React from 'react';
import { createRoot } from 'react-dom/client';
import { NativeApp } from './app';
import '../app/globals.css';

document.documentElement.lang = 'it';
document.body.classList.add('native-app');

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <NativeApp />
  </React.StrictMode>,
);
