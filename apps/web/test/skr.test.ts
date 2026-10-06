import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import {
  findMainDomainPda,
  parseMainDomain,
  parseNameHeader,
  parseReverseRecord,
  resolveSkrName,
  skrAccounts,
} from '@/lib/skr';
import fixture from './fixtures/skr-mainnet.json';
import { base64Account, fakeRpc } from './fake-rpc';

const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'));
const owner = address(fixture.owner);

describe('.skr accounts', () => {
  it('derives the AllDomains .skr parent, TLD house and name house', async () => {
    expect(await skrAccounts()).toEqual({
      parent: 'F3A8kuikEiu6k2399oSJ1PWfcJYDHqpwoQ2e8psSDNuF',
      tldHouse: '4RKP4BEMu5sXBfXSH7xN2owtQrnAJvhhwtBBmj9JEYkA',
      nameHouse: 'CPD3hKJE51VuiDE5u5Nosx1u7MXWwKGPff8HFJTtpX4V',
    });
  });

  it('derives the main domain PDA of a real owner', async () => {
    expect(await findMainDomainPda(owner)).toBe(fixture.mainDomainAddress);
  });

  it('parses real main domain, name and reverse-lookup accounts', () => {
    expect(parseMainDomain(bytes(fixture.mainDomain))).toEqual({
      nameAccount: fixture.nameAccountAddress,
      tld: '.skr',
      domain: 'rljjjrl',
    });
    expect(parseNameHeader(bytes(fixture.nameAccount))).toMatchObject({ owner: fixture.owner, expiresAt: 0 });
    expect(parseReverseRecord(bytes(fixture.reverseRecord))).toBe('rljjjrl');
  });
});

describe('resolveSkrName', () => {
  const accounts: Record<string, string> = {
    [fixture.mainDomainAddress]: fixture.mainDomain,
    [fixture.nameAccountAddress]: fixture.nameAccount,
    [fixture.reverseRecordAddress]: fixture.reverseRecord,
  };
  const getAccountInfo = (a: unknown) => ({ value: accounts[a as string] ? base64Account(accounts[a as string]) : null });

  it('reads the main domain', async () => {
    const rpc = fakeRpc({ getAccountInfo });
    expect(await resolveSkrName(rpc, owner)).toBe('rljjjrl.skr');
  });

  it('refuses a main domain whose name now belongs to someone else', async () => {
    const stranger = address('4EtAFmWtCzMxyUku7NofttEPLDWniigFAEL7KmCeCYKo');
    const strangersMain = await findMainDomainPda(stranger);
    const rpc = fakeRpc({
      // the stranger's main domain points at a name the fixture owner holds
      getAccountInfo: (a) => (a === strangersMain ? { value: base64Account(fixture.mainDomain) } : getAccountInfo(a)),
      getProgramAccounts: () => [],
    });
    expect(await resolveSkrName(rpc, stranger)).toBeNull();
    expect(rpc.calls.map((c) => c.method)).toContain('getProgramAccounts');
  });

  it('falls back to a held name through its reverse record', async () => {
    const rpc = fakeRpc({
      getAccountInfo: (a) => (a === fixture.mainDomainAddress ? { value: null } : getAccountInfo(a)),
      getProgramAccounts: () => [{ pubkey: fixture.nameAccountAddress, account: base64Account('') }],
      getMultipleAccounts: (list) => ({
        value: (list as string[]).map((a) => (accounts[a] ? base64Account(accounts[a]) : null)),
      }),
    });
    expect(await resolveSkrName(rpc, owner)).toBe('rljjjrl.skr');
  });
});
