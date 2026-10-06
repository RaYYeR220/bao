/** Initializes the program config on devnet: test genesis group, 1% fee on open packets. */
import { address, getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';
import { BAO_PROGRAM_ADDRESS, fetchMaybeConfig, findConfigPda, getInitConfigInstructionAsync } from '@bao/sdk';
import { explorer, loadKeypair, readOut, rpc, send, writeOut } from './env';

const UPGRADEABLE_LOADER = address('BPFLoaderUpgradeab1e11111111111111111111111');

async function main() {
  const admin = await loadKeypair();
  const group = readOut().genesisGroup as Address | undefined;
  if (!group) throw new Error('run `pnpm genesis` first');
  const [config] = await findConfigPda();
  const existing = await fetchMaybeConfig(rpc, config);
  if (existing.exists) {
    console.log(`config already initialized: ${config}`, existing.data);
    return;
  }
  const [programData] = await getProgramDerivedAddress({
    programAddress: UPGRADEABLE_LOADER,
    seeds: [getAddressEncoder().encode(BAO_PROGRAM_ADDRESS)],
  });
  const ix = await getInitConfigInstructionAsync({
    admin,
    program: BAO_PROGRAM_ADDRESS,
    programData,
    sgtGroup: group,
    treasury: admin.address,
    feeBps: 100,
    crankRewardLamports: 10_000n,
  });
  const sig = await send([ix], admin);
  writeOut({ programId: BAO_PROGRAM_ADDRESS, configPda: config, treasury: admin.address });
  console.log(`config ${config}\n  ${explorer(sig)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
