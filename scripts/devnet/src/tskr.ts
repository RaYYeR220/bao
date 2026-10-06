/** tSKR: a devnet stand-in for SKR (classic SPL, 6 decimals) used by the Playground faucet. */
import { address, generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import { TOKEN_PROGRAM_ADDRESS, getInitializeMint2Instruction, getMintSize } from '@solana-program/token';
import { getMintTestTokenInstructions } from '@bao/sdk/devnet-admin';
import { explorer, loadKeypair, readOut, rpc, send, writeOut } from './env';

export const TSKR_DECIMALS = 6;

export async function createTskrMint(authority: KeyPairSigner): Promise<Address> {
  const mint = await generateKeyPairSigner();
  const space = getMintSize();
  const sig = await send(
    [
      getCreateAccountInstruction({
        payer: authority,
        newAccount: mint,
        lamports: await rpc.getMinimumBalanceForRentExemption(BigInt(space)).send(),
        space,
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      getInitializeMint2Instruction({ mint: mint.address, decimals: TSKR_DECIMALS, mintAuthority: authority.address }),
    ],
    authority,
  );
  console.log(`tSKR mint ${mint.address}\n  ${explorer(sig)}`);
  return mint.address;
}

/** Mints `amount` base units of tSKR to `owner`, creating the owner's ATA if needed. */
export async function mintTskr(authority: KeyPairSigner, mint: Address, owner: Address, amount: bigint) {
  const { ata, instructions } = await getMintTestTokenInstructions({ authority, mint, owner, amount });
  const sig = await send(instructions, authority);
  return { ata, signature: sig };
}

async function main() {
  const authority = await loadKeypair();
  let mint = readOut().tskrMint as Address | undefined;
  if (!mint) {
    mint = await createTskrMint(authority);
    writeOut({ tskrMint: mint });
  }
  const owner = process.argv[2] ? address(process.argv[2]) : authority.address;
  const { ata, signature } = await mintTskr(authority, mint, owner, 1_000_000n * 10n ** BigInt(TSKR_DECIMALS));
  console.log(`1,000,000 tSKR -> ${owner} (${ata})\n  ${explorer(signature)}`);
}

if (process.argv[1].endsWith('tskr.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
