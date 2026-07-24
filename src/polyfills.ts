import { Buffer } from "buffer";

/**
 * Define the Node `Buffer` global before anything touches a bigWig.
 *
 * genomic-reader's AxiosDataLoader does `response.data instanceof Buffer`.
 * The genomebrowser package tries to polyfill this itself via a dynamic
 * `import("buffer")`, but that can resolve to Vite's Node built-in stub
 * instead of the npm package. Setting it eagerly here makes the package's
 * internal check short-circuit, so it never matters how that import resolves.
 */
if (typeof (globalThis as { Buffer?: unknown }).Buffer === "undefined") {
  (globalThis as { Buffer?: unknown }).Buffer = Buffer;
}
