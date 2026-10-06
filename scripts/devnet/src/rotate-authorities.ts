/**
 * Moves the tSKR mint authority and the test Genesis group update authority from the deployer
 * (which is also the program's upgrade authority) to the faucet key, so the API server never
 * needs the upgrade authority. Usage: tsx src/rotate-authorities.ts <path-to-faucet-keypair.json>
 */
import { address, some } from '@solana/kit';
import { AuthorityType, getSetAuthorityInstruction } from '@solana-program/token';
import { getUpdateTokenGroupUpdateAuthorityInstruction } from '@solana-program/token-2022';
import { explorer, loadKeypair, readOut, send } from './env';

async function main() {
  const faucetPath = process.argv[2];
  if (!faucetPath) throw new Error('usage: tsx src/rotate-authorities.ts <faucet-keypair.json>');
  const deployer = await loadKeypair();
  const faucet = await loadKeypair(faucetPath);
  const { genesisGroup, tskrMint } = readOut();
  const sig = await send(
    [
      getSetAuthorityInstruction({
        owned: address(tskrMint),
        owner: deployer,
        authorityType: AuthorityType.MintTokens,
        newAuthority: faucet.address,
      }),
      getUpdateTokenGroupUpdateAuthorityInstruction({
        group: address(genesisGroup),
        updateAuthority: deployer,
        newUpdateAuthority: some(faucet.address),
      }),
    ],
    deployer,
  );
  console.log(`tSKR mint authority and genesis group update authority -> ${faucet.address}\n  ${explorer(sig)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
