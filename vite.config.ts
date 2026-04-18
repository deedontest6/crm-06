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
            if (id.includes('@supabase/supabase-js')) return 'supabase';
            if (id.includes('recharts') || id.includes('d3-')) return 'recharts';
            if (id.includes('lucide-react')) return 'lucide';
            if (id.includes('@radix-ui')) return 'radix';
            if (id.includes('@hello-pangea/dnd') || id.includes('react-beautiful-dnd')) return 'dnd';
            if (id.includes('@tanstack/react-query')) return 'query';
            if (id.includes('date-fns')) return 'dates';
          }
        },
      },
    },
  },
}));
