import React from 'react';
import { createRoot } from 'react-dom/client';
import { RoomStudio } from '../app/components/room-studio';
import '../app/globals.css';

document.documentElement.lang = 'it';
document.body.classList.add('native-app');

document.addEventListener('click', (event) => {
  const target = event.target;
  if (target instanceof Element && target.closest('a[href="/projects"]')) {
    event.preventDefault();
  }
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RoomStudio />
  </React.StrictMode>,
);
