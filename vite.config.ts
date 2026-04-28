import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === 'development' && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            // IMPORTANT: react-vendor must be matched FIRST so tiny React-adjacent
            // shims (use-sync-external-store, react-redux, redux, scheduler) don't
            // get pulled into a feature chunk like `dnd`. If they did, the feature
            // chunk would import from react-vendor while react-vendor's deps would
            // import back from the feature chunk — a circular ESM import that
            // leaves React undefined at evaluation time and breaks the whole app
            // with "Cannot read properties of undefined (reading 'useSyncExternalStore')".
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/react-router-dom/') ||
              id.includes('/react-router/') ||
              id.includes('/scheduler/') ||
              id.includes('/use-sync-external-store/') ||
              id.includes('/react-redux/') ||
              id.includes('/redux/') ||
              id.includes('/@reduxjs/')
            ) return 'react-vendor';
            if (id.includes('@supabase/supabase-js')) return 'supabase';
            if (id.includes('recharts') || id.includes('d3-')) return 'recharts';
            if (id.includes('lucide-react')) return 'lucide';
            if (id.includes('@radix-ui')) return 'radix';
            if (id.includes('@hello-pangea/dnd') || id.includes('react-beautiful-dnd')) return 'dnd';
            if (id.includes('@tanstack/react-query')) return 'query';
            if (id.includes('date-fns')) return 'dates';
            if (
              id.includes('react-hook-form') ||
              id.includes('@hookform') ||
              id.includes('/zod/')
            ) return 'forms';
            if (
              id.includes('clsx') ||
              id.includes('tailwind-merge') ||
              id.includes('class-variance-authority')
            ) return 'utils';
          }
        },
      },
    },
  },
}));
