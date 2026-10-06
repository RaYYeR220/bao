import { env } from '@/lib/env';
import { log } from '@/lib/log';

/** Android App Links: lets https://<host>/p/<packet> open the Bao app directly. */
export async function GET() {
  const e = env();
  const fingerprints = (e.ANDROID_CERT_SHA256 ?? '')
    .split(',')
    .map((f) => f.trim().toUpperCase())
    .filter(Boolean);
  if (fingerprints.length === 0) log.once('assetlinks.no_cert', { note: 'ANDROID_CERT_SHA256 unset; App Links will not verify' });
  return Response.json(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: e.ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints },
      },
    ],
    { headers: { 'cache-control': 'public, max-age=300' } },
  );
}
