// vite.config.js
import { defineConfig } from "file:///sessions/relaxed-keen-lovelace/mnt/Arbora%20App/arbora/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/relaxed-keen-lovelace/mnt/Arbora%20App/arbora/node_modules/@vitejs/plugin-react/dist/index.js";
import { VitePWA } from "file:///sessions/relaxed-keen-lovelace/mnt/Arbora%20App/arbora/node_modules/vite-plugin-pwa/dist/index.js";
var base = process.env.VITE_BASE || "/arbora/";
var vite_config_default = defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "Arbora Notes",
        short_name: "Arbora Notes",
        description: "Note ad albero per imprenditori: Visioni, Viste, Progresso.",
        theme_color: "#1f7a4d",
        background_color: "#0f1411",
        display: "standalone",
        start_url: base,
        scope: base,
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallback: base + "index.html"
      }
    })
  ]
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvcmVsYXhlZC1rZWVuLWxvdmVsYWNlL21udC9BcmJvcmEgQXBwL2FyYm9yYVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL3Nlc3Npb25zL3JlbGF4ZWQta2Vlbi1sb3ZlbGFjZS9tbnQvQXJib3JhIEFwcC9hcmJvcmEvdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL3Nlc3Npb25zL3JlbGF4ZWQta2Vlbi1sb3ZlbGFjZS9tbnQvQXJib3JhJTIwQXBwL2FyYm9yYS92aXRlLmNvbmZpZy5qc1wiO2ltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGUnXG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnXG5pbXBvcnQgeyBWaXRlUFdBIH0gZnJvbSAndml0ZS1wbHVnaW4tcHdhJ1xuXG4vLyBJTVBPUlRBTlRFIHBlciBHaXRIdWIgUGFnZXM6XG4vLyBzZSBwdWJibGljaGkgc3UgaHR0cHM6Ly88dXRlbnRlPi5naXRodWIuaW8vYXJib3JhLyBsYXNjaWEgYmFzZSA9ICcvYXJib3JhLydcbi8vIHNlIHVzaSB1biBkb21pbmlvIGN1c3RvbSBvIHVuIHJlcG8gXCJ1c2VyLmdpdGh1Yi5pb1wiLCBtZXR0aSBiYXNlID0gJy8nXG5jb25zdCBiYXNlID0gcHJvY2Vzcy5lbnYuVklURV9CQVNFIHx8ICcvYXJib3JhLydcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgYmFzZSxcbiAgcGx1Z2luczogW1xuICAgIHJlYWN0KCksXG4gICAgVml0ZVBXQSh7XG4gICAgICByZWdpc3RlclR5cGU6ICdhdXRvVXBkYXRlJyxcbiAgICAgIGluY2x1ZGVBc3NldHM6IFsnZmF2aWNvbi5zdmcnLCAnaWNvbi0xOTIucG5nJywgJ2ljb24tNTEyLnBuZyddLFxuICAgICAgbWFuaWZlc3Q6IHtcbiAgICAgICAgbmFtZTogJ0FyYm9yYSBOb3RlcycsXG4gICAgICAgIHNob3J0X25hbWU6ICdBcmJvcmEgTm90ZXMnLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ05vdGUgYWQgYWxiZXJvIHBlciBpbXByZW5kaXRvcmk6IFZpc2lvbmksIFZpc3RlLCBQcm9ncmVzc28uJyxcbiAgICAgICAgdGhlbWVfY29sb3I6ICcjMWY3YTRkJyxcbiAgICAgICAgYmFja2dyb3VuZF9jb2xvcjogJyMwZjE0MTEnLFxuICAgICAgICBkaXNwbGF5OiAnc3RhbmRhbG9uZScsXG4gICAgICAgIHN0YXJ0X3VybDogYmFzZSxcbiAgICAgICAgc2NvcGU6IGJhc2UsXG4gICAgICAgIGljb25zOiBbXG4gICAgICAgICAgeyBzcmM6ICdpY29uLTE5Mi5wbmcnLCBzaXplczogJzE5MngxOTInLCB0eXBlOiAnaW1hZ2UvcG5nJyB9LFxuICAgICAgICAgIHsgc3JjOiAnaWNvbi01MTIucG5nJywgc2l6ZXM6ICc1MTJ4NTEyJywgdHlwZTogJ2ltYWdlL3BuZycgfSxcbiAgICAgICAgICB7IHNyYzogJ2ljb24tNTEyLnBuZycsIHNpemVzOiAnNTEyeDUxMicsIHR5cGU6ICdpbWFnZS9wbmcnLCBwdXJwb3NlOiAnbWFza2FibGUnIH1cbiAgICAgICAgXVxuICAgICAgfSxcbiAgICAgIHdvcmtib3g6IHtcbiAgICAgICAgZ2xvYlBhdHRlcm5zOiBbJyoqLyoue2pzLGNzcyxodG1sLHN2ZyxwbmcsaWNvLHdvZmYyfSddLFxuICAgICAgICBuYXZpZ2F0ZUZhbGxiYWNrOiBiYXNlICsgJ2luZGV4Lmh0bWwnXG4gICAgICB9XG4gICAgfSlcbiAgXVxufSlcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBbVYsU0FBUyxvQkFBb0I7QUFDaFgsT0FBTyxXQUFXO0FBQ2xCLFNBQVMsZUFBZTtBQUt4QixJQUFNLE9BQU8sUUFBUSxJQUFJLGFBQWE7QUFFdEMsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUI7QUFBQSxFQUNBLFNBQVM7QUFBQSxJQUNQLE1BQU07QUFBQSxJQUNOLFFBQVE7QUFBQSxNQUNOLGNBQWM7QUFBQSxNQUNkLGVBQWUsQ0FBQyxlQUFlLGdCQUFnQixjQUFjO0FBQUEsTUFDN0QsVUFBVTtBQUFBLFFBQ1IsTUFBTTtBQUFBLFFBQ04sWUFBWTtBQUFBLFFBQ1osYUFBYTtBQUFBLFFBQ2IsYUFBYTtBQUFBLFFBQ2Isa0JBQWtCO0FBQUEsUUFDbEIsU0FBUztBQUFBLFFBQ1QsV0FBVztBQUFBLFFBQ1gsT0FBTztBQUFBLFFBQ1AsT0FBTztBQUFBLFVBQ0wsRUFBRSxLQUFLLGdCQUFnQixPQUFPLFdBQVcsTUFBTSxZQUFZO0FBQUEsVUFDM0QsRUFBRSxLQUFLLGdCQUFnQixPQUFPLFdBQVcsTUFBTSxZQUFZO0FBQUEsVUFDM0QsRUFBRSxLQUFLLGdCQUFnQixPQUFPLFdBQVcsTUFBTSxhQUFhLFNBQVMsV0FBVztBQUFBLFFBQ2xGO0FBQUEsTUFDRjtBQUFBLE1BQ0EsU0FBUztBQUFBLFFBQ1AsY0FBYyxDQUFDLHNDQUFzQztBQUFBLFFBQ3JELGtCQUFrQixPQUFPO0FBQUEsTUFDM0I7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNIO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
