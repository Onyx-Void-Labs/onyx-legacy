import { defineConfig } from "vite";
import tailwindcss from '@tailwindcss/vite'
import react from "@vitejs/plugin-react";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  base: "./",
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@/components": path.resolve(__dirname, "./src/components"),
      "@/lib": path.resolve(__dirname, "./src/lib"),
      "@/hooks": path.resolve(__dirname, "./src/hooks"),
      "@/types": path.resolve(__dirname, "./src/types"),
      "@/store": path.resolve(__dirname, "./src/store"),
      "@/utils": path.resolve(__dirname, "./src/utils"),
      "@/services": path.resolve(__dirname, "./src/services"),
      "@/contexts": path.resolve(__dirname, "./src/contexts"),
      "@/data": path.resolve(__dirname, "./src/data"),
    },
  },

  // ─── Build Optimisation ────────────────────────────────────────────
  build: {
    // Suppress the 500kB chunk warning — we split manually below
    chunkSizeWarningLimit: 2000,

    // Target modern browsers (Android WebView 80+, Safari 15+)
    target: "es2021",

    // Terser for aggressive minification (smaller APK JS payload)
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ["console.log", "console.warn", "console.info", "console.debug"],
        passes: 2,
      },
      mangle: {
        safari10: true,
      },
      format: {
        comments: false,
      },
    },

    // Manual chunk splitting — keeps each chunk <500kB gzipped
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // ── Tauri API + plugins ──
          if (id.includes("@tauri-apps/")) {
            return "vendor-tauri";
          }

          // ── Tiptap core + extensions ──
          if (id.includes("@tiptap/") || id.includes("prosemirror")) {
            return "vendor-tiptap";
          }

          // ── Yjs / CRDT / Collaboration ──
          if (
            id.includes("/yjs/") ||
            id.includes("y-indexeddb") ||
            id.includes("y-websocket") ||
            id.includes("y-leveldb") ||
            id.includes("y-codemirror") ||
            id.includes("@hocuspocus/") ||
            id.includes("lib0")
          ) {
            return "vendor-yjs";
          }

          // ── PocketBase ──
          if (id.includes("pocketbase")) {
            return "vendor-pocketbase";
          }

          // ── CodeMirror (code blocks) ──
          if (id.includes("@codemirror/") || id.includes("@lezer/")) {
            return "vendor-codemirror";
          }

          // ── Crypto / Auth / Security ──
          if (
            id.includes("crypto-js") ||
            id.includes("otpauth") ||
            id.includes("otplib") ||
            id.includes("bip39") ||
            id.includes("@fingerprintjs/")
          ) {
            return "vendor-crypto";
          }

          // ── Stripe (lazy-loaded, rarely needed) ──
          if (id.includes("@stripe/")) {
            return "vendor-stripe";
          }

          // ── UI utilities (dnd-kit, floating-ui, lucide) ──
          if (
            id.includes("@dnd-kit/") ||
            id.includes("@floating-ui/") ||
            id.includes("lucide-react")
          ) {
            return "vendor-ui";
          }

          // ── KaTeX (math rendering) ──
          if (id.includes("katex") || id.includes("react-katex")) {
            return "vendor-katex";
          }

          // ── Syntax highlighting (lowlight/highlight.js) ──
          if (id.includes("lowlight") || id.includes("highlight.js")) {
            return "vendor-highlight";
          }

          // ── React core ──
          if (id.includes("react-dom") || id.includes("/react/") || id.includes("/scheduler/")) {
            return "vendor-react";
          }

          // ── Remaining node_modules → generic vendor ──
          if (id.includes("node_modules")) {
            return "vendor-misc";
          }
        },
      },
    },

    // Enable source maps for debugging (stripped in release by Tauri)
    sourcemap: false,

    // CSS code splitting
    cssCodeSplit: true,
  },

  // ─── Vite options tailored for Tauri development ───────────────────
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` and `apps/desktop`
      ignored: ["**/src-tauri/**", "**/apps/desktop/**"],
    },
  },
}));
