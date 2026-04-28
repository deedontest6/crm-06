import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

const rootEl = document.getElementById("root")!;
createRoot(rootEl).render(<App />);

// Explicitly remove the inline #app-loader spinner once React has committed.
// This avoids relying solely on the CSS sibling selector in index.html, which
// can leave the spinner visible if paint order or z-index makes it overlap
// the mounted app.
requestAnimationFrame(() => {
  document.getElementById("app-loader")?.remove();
});
