/**
 * "Bao Test Genesis" — a devnet Token-2022 group shaped like the Seeker Genesis Token
 * collection. Members are 0-decimal, supply-1 mints with a TokenGroupMember extension
 * pointing at the group and a metadata pointer equal to the group address: exactly what
 * the program checks. The Playground faucet mints one to any wallet, so testers without
 * a Seeker can run the full loop on devnet.
 */
import { address, generateKeyPairSigner, some, type Address, type KeyPairSigner } from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  extension,
  getInitializeMintInstruction,
  getMintSize,
  getPostInitializeInstructionsForMintExtensions,
  getPreInitializeInstructionsForMintExtensions,
} from '@solana-program/token-2022';
import { genesisMemberRentSpace, getMintGenesisMemberInstructions } from '@bao/sdk/devnet-admin';
import { explorer, loadKeypair, readOut, rpc, send, writeOut } from './env';

async function rentFor(space: number) {
  return rpc.getMinimumBalanceForRentExemption(BigInt(space)).send();
}

export async function createGenesisGroup(authority: KeyPairSigner): Promise<Address> {
  const group = await generateKeyPairSigner();
  const pre = [extension('GroupPointer', { authority: some(authority.address), groupAddress: some(group.address) })];
  const post = [
    extension('TokenGroup', {
      updateAuthority: some(authority.address),
      mint: group.address,
      size: 0n,
      maxSize: 1_000_000n,
    }),
  ];
  const space = getMintSize(pre);
  const sig = await send(
    [
      getCreateAccountInstruction({
        payer: authority,
        newAccount: group,
        lamports: await rentFor(getMintSize([...pre, ...post])),
        space,
        programAddress: TOKEN_2022_PROGRAM_ADDRESS,
      }),
      ...getPreInitializeInstructionsForMintExtensions(group.address, pre),
      getInitializeMintInstruction({ mint: group.address, decimals: 0, mintAuthority: authority.address }),
      ...getPostInitializeInstructionsForMintExtensions(group.address, authority, post),
    ],
    authority,
  );
  console.log(`genesis group ${group.address}\n  ${explorer(sig)}`);
  return group.address;
}

/** Mints one test Genesis token to `owner`. `authority` is the group update authority. */
export async function mintGenesisMember(authority: KeyPairSigner, group: Address, owner: Address) {
  const member = await generateKeyPairSigner();
  const lamports = await rentFor(genesisMemberRentSpace(authority.address, member.address, group));
  const { mint, tokenAccount, instructions } = await getMintGenesisMemberInstructions({ authority, member, group, owner, lamports });
  const sig = await send(instructions, authority);
  return { mint, tokenAccount, signature: sig };
}

async function main() {
  const authority = await loadKeypair(process.env.BAO_MINT_AUTHORITY || undefined);
  let group = readOut().genesisGroup as Address | undefined;
  if (!group) {
    group = await createGenesisGroup(authority);
    writeOut({ genesisGroup: group });
  }
  const owner = process.argv[2] ? address(process.argv[2]) : authority.address;
  const minted = await mintGenesisMember(authority, group, owner);
  console.log(`genesis member ${minted.mint} -> ${owner}\n  ${explorer(minted.signature)}`);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('genesis-group.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
