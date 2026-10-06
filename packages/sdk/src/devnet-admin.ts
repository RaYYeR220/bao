/**
 * Devnet-only admin instructions for the Playground faucet: test Genesis tokens shaped like the
 * Seeker Genesis Token (Token-2022 group member, metadata pointer = group) and tSKR mints.
 * Shared by the API faucet and scripts/devnet. Never used against mainnet.
 */
import { some, type Address, type Instruction, type TransactionSigner } from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
  AuthorityType,
  TOKEN_2022_PROGRAM_ADDRESS,
  extension,
  findAssociatedTokenPda as findAta2022,
  getCreateAssociatedTokenIdempotentInstruction as createAta2022,
  getInitializeMintInstruction,
  getInitializeTokenGroupMemberInstruction,
  getMintSize as getMint2022Size,
  getMintToInstruction as mintTo2022,
  getPreInitializeInstructionsForMintExtensions,
  getSetAuthorityInstruction,
} from '@solana-program/token-2022';
import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintToInstruction,
} from '@solana-program/token';

function genesisExtensions(authority: Address, member: Address, group: Address) {
  const pre = [
    extension('GroupMemberPointer', { authority: some(authority), memberAddress: some(member) }),
    extension('MetadataPointer', { authority: some(authority), metadataAddress: some(group) }),
  ];
  const full = [...pre, extension('TokenGroupMember', { mint: member, group, memberNumber: 0n })];
  return { pre, full };
}

/** Bytes the member mint holds once the group-member extension is written (rent is paid for these). */
export function genesisMemberRentSpace(authority: Address, member: Address, group: Address): number {
  return getMint2022Size(genesisExtensions(authority, member, group).full);
}

export interface GenesisMemberParams {
  /** Mint authority of the new member and update authority of the group; pays for everything. */
  authority: TransactionSigner;
  /** A fresh keypair: the member mint address. */
  member: TransactionSigner;
  group: Address;
  owner: Address;
  /** Rent for `genesisMemberRentSpace(...)` bytes. */
  lamports: bigint;
}

/**
 * Creates a 0-decimal, supply-1 Token-2022 mint that is a member of `group`, with its metadata
 * pointer set to the group (what the program checks), mints it to `owner`, and drops the mint
 * authority so the supply stays 1.
 */
export async function getMintGenesisMemberInstructions(p: GenesisMemberParams) {
  const { pre } = genesisExtensions(p.authority.address, p.member.address, p.group);
  const [tokenAccount] = await findAta2022({ owner: p.owner, mint: p.member.address, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });
  const instructions: Instruction[] = [
    getCreateAccountInstruction({
      payer: p.authority,
      newAccount: p.member,
      lamports: p.lamports,
      space: getMint2022Size(pre),
      programAddress: TOKEN_2022_PROGRAM_ADDRESS,
    }),
    ...getPreInitializeInstructionsForMintExtensions(p.member.address, pre),
    getInitializeMintInstruction({ mint: p.member.address, decimals: 0, mintAuthority: p.authority.address }),
    getInitializeTokenGroupMemberInstruction({
      member: p.member.address,
      memberMint: p.member.address,
      memberMintAuthority: p.authority,
      group: p.group,
      groupUpdateAuthority: p.authority,
    }),
    createAta2022({
      payer: p.authority,
      ata: tokenAccount,
      owner: p.owner,
      mint: p.member.address,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    }),
    mintTo2022({ mint: p.member.address, token: tokenAccount, mintAuthority: p.authority, amount: 1n }),
    getSetAuthorityInstruction({
      owned: p.member.address,
      owner: p.authority,
      authorityType: AuthorityType.MintTokens,
      newAuthority: null,
    }),
  ];
  return { mint: p.member.address, tokenAccount, instructions };
}

/** Mints `amount` base units of a classic SPL test mint to `owner`, creating the owner's ATA if needed. */
export async function getMintTestTokenInstructions(p: { authority: TransactionSigner; mint: Address; owner: Address; amount: bigint }) {
  const [ata] = await findAssociatedTokenPda({ owner: p.owner, mint: p.mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const instructions: Instruction[] = [
    getCreateAssociatedTokenIdempotentInstruction({ payer: p.authority, ata, owner: p.owner, mint: p.mint }),
    getMintToInstruction({ mint: p.mint, token: ata, mintAuthority: p.authority, amount: p.amount }),
  ];
  return { ata, instructions };
}
