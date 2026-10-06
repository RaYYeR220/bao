import type { NextConfig } from 'next';

const config: NextConfig = {
  // the sdk ships TypeScript source from the workspace
  transpilePackages: ['@bao/sdk'],
  // native/wasm database drivers stay out of the bundle
  serverExternalPackages: ['pg', '@electric-sql/pglite'],
  poweredByHeader: false,
};

export default config;
