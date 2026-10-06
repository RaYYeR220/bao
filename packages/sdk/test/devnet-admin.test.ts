import { AccountRole, generateKeyPairSigner } from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from '@solana-program/token';
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { describe, expect, it } from 'vitest';
import { genesisMemberRentSpace, getMintGenesisMemberInstructions, getMintTestTokenInstructions } from '../src/devnet-admin';

describe('test genesis member', () => {
  it('creates a group member mint, mints one to the owner and drops the mint authority', async () => {
    const authority = await generateKeyPairSigner();
    const member = await generateKeyPairSigner();
    const group = (await generateKeyPairSigner()).address;
    const owner = (await generateKeyPairSigner()).address;
    const { mint, tokenAccount, instructions } = await getMintGenesisMemberInstructions({
      authority,
      member,
      group,
      owner,
      lamports: 1n,
    });
    expect(mint).toBe(member.address);
    expect(instructions[0].programAddress).toBe(SYSTEM_PROGRAM_ADDRESS);
    expect(instructions.slice(1).every((ix) => ix.programAddress === TOKEN_2022_PROGRAM_ADDRESS || ix.programAddress.startsWith('ATok'))).toBe(true);
    // pointers, mint init, group member, ata, mint-to, set-authority
    expect(instructions).toHaveLength(8);
    const signers = new Set(
      instructions.flatMap((ix) => (ix.accounts ?? []).filter((a) => a.role === AccountRole.WRITABLE_SIGNER || a.role === AccountRole.READONLY_SIGNER).map((a) => a.address)),
    );
    expect([...signers].sort()).toEqual([authority.address, member.address].sort());
    expect(instructions.some((ix) => ix.accounts?.some((a) => a.address === tokenAccount))).toBe(true);
    expect(genesisMemberRentSpace(authority.address, member.address, group)).toBeGreaterThan(165);
  });
});

describe('test token mint', () => {
  it('creates the ata idempotently and mints', async () => {
    const authority = await generateKeyPairSigner();
    const mint = (await generateKeyPairSigner()).address;
    const owner = (await generateKeyPairSigner()).address;
    const { ata, instructions } = await getMintTestTokenInstructions({ authority, mint, owner, amount: 5n });
    expect(ata).toBe((await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0]);
    expect(instructions.map((ix) => ix.programAddress)).toEqual(['ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', TOKEN_PROGRAM_ADDRESS]);
  });
});
