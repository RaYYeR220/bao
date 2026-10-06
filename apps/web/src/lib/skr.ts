/**
 * `.skr` names (AllDomains, mainnet). Reverse lookup, owner -> name:
 *   1. the owner's main domain (TLD House PDA ["main_domain", owner]) when it is a `.skr` the
 *      owner still holds;
 *   2. otherwise any `.skr` name account the owner holds (ANS accounts filtered by parent and
 *      owner), resolved through its reverse-lookup record.
 * Read-only and best effort: any failure resolves to null.
 */
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
  getProgramDerivedAddress,
  type Address,
} from '@solana/kit';
import { sha256 } from '@noble/hashes/sha256';
import type { SolanaRpc } from './rpc';

export const ANS_PROGRAM = address('ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK');
export const TLD_HOUSE_PROGRAM = address('TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S');
export const NAME_HOUSE_PROGRAM = address('NH3uX6FtVE2fNREAioP7hm5RaozotZxeL6khU1EHx51');
const TLD = '.skr';
const HASH_PREFIX = 'ALT Name Service';
/** discriminator + parent + owner + class + expires_at + created_at + non_transferable + padding */
const HEADER_SIZE = 8 + 32 + 32 + 32 + 8 + 8 + 1 + 79;
const ZERO = new Uint8Array(32);
const text = new TextEncoder();
const addressBytes = getAddressEncoder();
const addressFromBytes = getAddressDecoder();

export const hashedName = (name: string) => sha256(text.encode(HASH_PREFIX + name));

async function nameAccount(hashed: Uint8Array, nameClass?: Address, parent?: Address) {
  const [pda] = await getProgramDerivedAddress({
    programAddress: ANS_PROGRAM,
    seeds: [hashed, nameClass ? addressBytes.encode(nameClass) : ZERO, parent ? addressBytes.encode(parent) : ZERO],
  });
  return pda;
}

export async function skrAccounts() {
  const origin = await nameAccount(hashedName('ANS'));
  const parent = await nameAccount(hashedName(TLD), undefined, origin);
  const [tldHouse] = await getProgramDerivedAddress({
    programAddress: TLD_HOUSE_PROGRAM,
    seeds: [text.encode('tld_house'), text.encode(TLD)],
  });
  const [nameHouse] = await getProgramDerivedAddress({
    programAddress: NAME_HOUSE_PROGRAM,
    seeds: [text.encode('name_house'), addressBytes.encode(tldHouse)],
  });
  return { parent, tldHouse, nameHouse };
}

export async function findMainDomainPda(owner: Address) {
  const [pda] = await getProgramDerivedAddress({
    programAddress: TLD_HOUSE_PROGRAM,
    seeds: [text.encode('main_domain'), addressBytes.encode(owner)],
  });
  return pda;
}

/** MainDomain: discriminator, name_account, tld (borsh string), domain (borsh string). */
export function parseMainDomain(data: Uint8Array): { nameAccount: Address; tld: string; domain: string } | null {
  if (data.length < 8 + 32 + 4) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const nameAccount = addressFromBytes.decode(data.subarray(8, 40));
  let offset = 40;
  const readString = () => {
    const len = view.getUint32(offset, true);
    const value = new TextDecoder().decode(data.subarray(offset + 4, offset + 4 + len));
    offset += 4 + len;
    return value;
  };
  const tld = readString();
  const domain = readString();
  return { nameAccount, tld, domain };
}

export function parseNameHeader(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    parent: addressFromBytes.decode(data.subarray(8, 40)),
    owner: addressFromBytes.decode(data.subarray(40, 72)),
    expiresAt: Number(view.getBigUint64(104, true)),
  };
}

/** The domain text stored after the header of a reverse-lookup record. */
export function parseReverseRecord(data: Uint8Array): string | null {
  const raw = new TextDecoder().decode(data.subarray(HEADER_SIZE)).replace(/\0[\s\S]*$/, '').trim();
  return raw.length > 0 ? raw : null;
}

const withTld = (domain: string) => (domain.endsWith(TLD) ? domain : `${domain}${TLD}`);

async function accountData(rpc: SolanaRpc, account: Address): Promise<Uint8Array | null> {
  const { value } = await rpc.getAccountInfo(account, { encoding: 'base64', commitment: 'confirmed' }).send();
  return value ? new Uint8Array(Buffer.from(value.data[0], 'base64')) : null;
}

async function ownsWrapped(rpc: SolanaRpc, owner: Address, nftRecord: Address): Promise<boolean> {
  const record = await accountData(rpc, nftRecord);
  // NftRecord: discriminator, tag, bump, name_account, owner, nft_mint, tld_house
  if (!record || record.length < 8 + 2 + 32 * 3) return false;
  const mint = addressFromBytes.decode(record.subarray(8 + 2 + 64, 8 + 2 + 96));
  const { value } = await rpc.getTokenLargestAccounts(mint).send();
  const holder = value.find((a) => a.amount === '1');
  if (!holder) return false;
  const { value: info } = await rpc.getAccountInfo(holder.address, { encoding: 'jsonParsed' }).send();
  const parsed = (info?.data as { parsed?: { info?: { owner?: string } } } | undefined)?.parsed;
  return parsed?.info?.owner === owner;
}

async function heldBy(rpc: SolanaRpc, owner: Address, name: Address, nameHouse: Address, now: number): Promise<boolean> {
  const data = await accountData(rpc, name);
  if (!data) return false;
  const header = parseNameHeader(data);
  if (header.expiresAt !== 0 && header.expiresAt < now) return false;
  if (header.owner === owner) return true;
  const [nftRecord] = await getProgramDerivedAddress({
    programAddress: NAME_HOUSE_PROGRAM,
    seeds: [text.encode('nft_record'), addressBytes.encode(nameHouse), addressBytes.encode(name)],
  });
  return header.owner === nftRecord && (await ownsWrapped(rpc, owner, nftRecord));
}

async function mainDomainName(rpc: SolanaRpc, owner: Address, nameHouse: Address, now: number): Promise<string | null> {
  const data = await accountData(rpc, await findMainDomainPda(owner));
  const main = data ? parseMainDomain(data) : null;
  if (!main || main.tld !== TLD) return null;
  return (await heldBy(rpc, owner, main.nameAccount, nameHouse, now)) ? withTld(main.domain) : null;
}

export async function ownedSkrName(rpc: SolanaRpc, owner: Address, parent: Address, tldHouse: Address): Promise<string | null> {
  const accounts = await rpc
    .getProgramAccounts(ANS_PROGRAM, {
      encoding: 'base64',
      dataSlice: { offset: 0, length: 0 },
      filters: [
        { memcmp: { offset: 8n, bytes: parent as string as never, encoding: 'base58' } },
        { memcmp: { offset: 40n, bytes: owner as string as never, encoding: 'base58' } },
      ],
    })
    .send();
  if (accounts.length === 0) return null;
  const reverse = await Promise.all(
    accounts.slice(0, 20).map(async (a) => nameAccount(hashedName(a.pubkey), tldHouse)),
  );
  const { value } = await rpc.getMultipleAccounts(reverse, { encoding: 'base64' }).send();
  const names = value
    .map((v) => (v ? parseReverseRecord(new Uint8Array(Buffer.from(v.data[0], 'base64'))) : null))
    .filter((n): n is string => n !== null)
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  return names[0] ? withTld(names[0]) : null;
}

export async function resolveSkrName(rpc: SolanaRpc, owner: Address, now = Math.floor(Date.now() / 1000)): Promise<string | null> {
  const { parent, tldHouse, nameHouse } = await skrAccounts();
  const main = await mainDomainName(rpc, owner, nameHouse, now);
  if (main) return main;
  return ownedSkrName(rpc, owner, parent, tldHouse);
}

export const base58 = (bytes: Uint8Array) => getBase58Decoder().decode(bytes);
