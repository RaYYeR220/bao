import { ACTIONS_CORS, actionJson } from '@/lib/actions';

export const GET = async () =>
  actionJson({
    rules: [
      { pathPattern: '/p/*', apiPath: '/api/actions/grab/*' },
      { pathPattern: '/api/actions/**', apiPath: '/api/actions/**' },
    ],
  });

export const OPTIONS = async () => new Response(null, { status: 204, headers: ACTIONS_CORS });
