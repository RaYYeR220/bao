import { isSome, type Address, type Rpc, type SolanaRpcApi } from '@solana/kit';
import { TOKEN_2022_PROGRAM_ADDRESS, fetchMint } from '@solana-program/token-2022';

export type GenesisToken = { mint: Address; tokenAccount: Address };

/**
 * Finds the wallet's Seeker Genesis Token: a Token-2022 NFT whose mint is a member of
 * `group` and whose metadata pointer is the group address — the same shape the program
 * checks on-chain. `group` is the real Seeker group on mainnet or the test group on devnet.
 */
export async function findGenesisToken(
  rpc: Rpc<SolanaRpcApi>,
  owner: Address,
  group: Address,
): Promise<GenesisToken | null> {
  const { value } = await rpc
    .getTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ADDRESS }, { encoding: 'jsonParsed' })
    .send();
  for (const { pubkey, account } of value) {
    const info = (account.data as { parsed?: { info?: { mint: string; tokenAmount?: { amount: string } } } }).parsed?.info;
    if (!info || info.tokenAmount?.amount !== '1') continue;
    const mint = await fetchMint(rpc, info.mint as Address);
    const extensions = isSome(mint.data.extensions) ? mint.data.extensions.value : [];
    const member = extensions.find((e) => e.__kind === 'TokenGroupMember');
    const pointer = extensions.find((e) => e.__kind === 'MetadataPointer');
    const metadata = pointer && pointer.__kind === 'MetadataPointer' && isSome(pointer.metadataAddress) ? pointer.metadataAddress.value : null;
    if (member && member.__kind === 'TokenGroupMember' && member.group === group && metadata === group) {
      return { mint: info.mint as Address, tokenAccount: pubkey };
    }
  }
  return null;
}
