/** Shared dependencies for route handlers; tests swap them with setStore/setRpcs. */
import { getStore } from './db';
import { devnetRpc, mainnetRpc } from './rpc';

export async function deps() {
  return { store: await getStore(), devnet: devnetRpc(), mainnet: mainnetRpc() };
}

export type Ctx<P extends string> = { params: Promise<Record<P, string>> };
