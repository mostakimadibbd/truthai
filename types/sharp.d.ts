/**
 * Minimal local typings for sharp — the package ships without
 * bundled TypeScript declarations in this dependency tree, and
 * only the raw-pixel decode surface used by
 * lib/server/watermark.ts is modelled here.
 */
declare module "sharp" {
  type SharpRawResult = {
    data: Buffer;
    info: { width: number; height: number; channels: number };
  };

  type SharpPipeline = {
    ensureAlpha(): SharpPipeline;
    raw(): {
      toBuffer(options: { resolveWithObject: true }): Promise<SharpRawResult>;
    };
  };

  export default function sharp(input: Buffer): SharpPipeline;
}
