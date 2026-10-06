import { createFromRoot } from 'codama';
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const idl = JSON.parse(readFileSync(new URL('../../target/idl/bao.json', import.meta.url), 'utf8'));
const codama = createFromRoot(rootNodeFromAnchor(idl));
await codama.accept(renderVisitor(fileURLToPath(new URL('./src/generated', import.meta.url))));
