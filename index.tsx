import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { installViewportHeightSync } from './lib/viewportHeightSync';
import { installAppPreferences } from './lib/appPreferences';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

installViewportHeightSync();
installAppPreferences();

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
