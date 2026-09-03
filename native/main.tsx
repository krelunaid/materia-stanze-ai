import React from 'react';
import { createRoot } from 'react-dom/client';
import { RoomStudio } from '../app/components/room-studio';
import '../app/globals.css';

document.documentElement.lang = 'it';
document.documentElement.classList.add('native-app');
document.body.classList.add('native-app');

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RoomStudio />
  </React.StrictMode>,
);
