export * from './generated';
export * from './math';
export * from './merkle';
export * from './pda';
export * from './sgt';
export * from './api';
import devnet from './devnet.json';

/** Public devnet deployment (written by scripts/devnet). */
export const DEVNET = devnet as {
  programId: string;
  configPda?: string;
  genesisGroup?: string;
  tskrMint?: string;
  treasury?: string;
};
