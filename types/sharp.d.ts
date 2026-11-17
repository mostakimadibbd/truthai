/**
 * Minimal local typings for sharp — the package ships without
 * bundled TypeScript declarations in this dependency tree, and
 * only the surface used by the codebase is modelled here: the
 * raw-pixel decode surface used by lib/server/watermark.ts, plus
 * the metadata / region / composite surface used by the image
 * generation route to strip source branding from Pollinations
 * pictures (app/api/images/generate/route.ts).
 */
declare module "sharp" {
  type SharpRawResult = {
    data: Buffer;
    info: { width: number; height: number; channels: number };
  };

  type SharpMetadata = {
    width?: number;
    height?: number;
    format?: string;
    channels?: number;
  };

  type SharpRegion = {
    left: number;
    top: number;
    width: number;
    height: number;
  };

  type SharpOverlay = {
    input: Buffer;
    left: number;
    top: number;
  };

  type SharpPipeline = {
    ensureAlpha(): SharpPipeline;
    metadata(): Promise<SharpMetadata>;
    extract(region: SharpRegion): SharpPipeline;
    blur(sigma?: number): SharpPipeline;
    median(size?: number): SharpPipeline;
    composite(images: SharpOverlay[]): SharpPipeline;
    png(): SharpPipeline;
    toBuffer(): Promise<Buffer>;
    raw(): {
      toBuffer(options: { resolveWithObject: true }): Promise<SharpRawResult>;
    };
  };

  export default function sharp(input: Buffer): SharpPipeline;
}
