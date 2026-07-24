import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Optional. Only needed if the SCREEN GraphQL service rejects anonymous
  // requests. Put SCREEN_API_KEY=... in a .env file (never commit it) and it
  // is attached server-side by the proxy, so it never reaches the browser.
  const screenApiKey = loadEnv(mode, process.cwd(), "").SCREEN_API_KEY;

  return {
    plugins: [react()],

  // `genomic-reader` (used to read bigWigs) was written for Node and checks
  // `response.data instanceof Buffer`. Browsers have no `Buffer`, so without
  // the lines below the first bigWig read throws
  // "Right hand side of 'instanceof' is not an object".
    define: {
      global: "globalThis",
    },
    resolve: {
      alias: {
      // `buffer` is both a Node built-in and an npm package. Vite resolves it
      // to the built-in stub by default, which makes the package's own
      // polyfill assign `undefined`. This forces the real npm package.
        buffer: "buffer",
      },
    },
    optimizeDeps: {
      include: ["buffer"],
    },

    server: {
      proxy: {
        // transcriptModule POSTs here; forwarded to the SCREEN GraphQL service.
        "/api/screen-graphql": {
          target: "https://screen.api.wenglab.org",
          changeOrigin: true,
          rewrite: () => "/graphql",
          ...(screenApiKey
            ? { headers: { authorization: `Bearer ${screenApiKey}` } }
            : {}),
        },
      },
    },
  };
});
