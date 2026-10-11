// The injection mistakes (docs/DESIGN.md §2.3) as mutations of an installed example project. Each suite
// states, per mistake and per command, what it OBSERVES; nothing here knows about a particular bundler.
import fs from 'node:fs';
import path from 'node:path';
import { packs, read, write, readJson, writeJson } from './lib.mjs';

const BUTTON = 'src/overrides/Button.tsx';
const edit = (dir, rel, fn) => write(dir, rel, fn(read(dir, rel)));
const swapSdk = (tgz) => (dir, ws) => ws.swapDep(dir, '@acme/core', `file:${packs}/${tgz}`);

/** Button override with its OWN props interface, exactly @acme/core@1.0.0's ButtonProps (no SlotProps). */
const OWN_PROPS_BUTTON = `import type { ReactNode, Ref } from 'react';
import { Button as Original } from '@acme/core/original/Button';

export interface MyButtonProps { children?: ReactNode; variant?: 'primary' | 'secondary'; onClick?: () => void; ref?: Ref<HTMLButtonElement> }
export function Button(props: MyButtonProps) {
  return <span data-sd="BRAND_BUTTON" data-ctx="own"><Original {...props} /></span>;
}
`;

/**
 * id: catalogue id; what: one line; apply(dir, ws): mutate a fresh copy of the installed example.
 * render: the expected markers when the T1 build passes (null = do not probe).
 */
export const MISTAKES = [
  { id: 'F1a', what: 'override requires an extra prop',
    apply: (d) => edit(d, BUTTON, (s) => s.replace("(props: SlotProps['Button'])", "(props: SlotProps['Button'] & { tone: 'loud' })")) },
  { id: 'F1a-narrow', what: 'override narrows a union prop',
    apply: (d) => edit(d, BUTTON, (s) => s.replace("(props: SlotProps['Button'])", "(props: Omit<SlotProps['Button'], 'variant'> & { variant?: 'primary' })")) },
  { id: 'F1b', what: 'override ignores contract props',
    apply: (d) => edit(d, BUTTON, (s) => s.replace("(props: SlotProps['Button'])", "(props: Pick<SlotProps['Button'], 'children'>)")) },
  { id: 'F1b-upgrade', what: 'own-props override, SDK upgraded to 1.1.0 (contract widened)',
    apply: (d, ws) => { write(d, BUTTON, OWN_PROPS_BUTTON); swapSdk('acme-core-1.1.0.tgz')(d, ws); } },
  { id: 'F1c', what: 'MUST PASS: forwardRef Button, class Logo (memo PriceTag is the baseline)',
    apply: (d) => {
      write(d, BUTTON, `import { forwardRef } from 'react';
import { Button as Original } from '@acme/core/original/Button';
import type { SlotProps } from '@acme/core/contracts';
import { useTheme } from '../theme';

type P = Omit<SlotProps['Button'], 'ref'>;
export const Button = forwardRef<HTMLButtonElement, P>(function Button(props, ref) {
  const theme = useTheme();
  return <span className="brand-button" data-sd="BRAND_BUTTON" data-ctx={theme}><Original {...props} ref={ref} /></span>;
});
`);
      write(d, 'src/overrides/Logo.tsx', `import { Component } from 'react';
import type { SlotProps } from '@acme/core/contracts';

export class Logo extends Component<SlotProps['Logo']> {
  render() { const size = this.props.size ?? 32; return <svg data-sd="BRAND_LOGO" width={size} height={size} viewBox="0 0 32 32" />; }
}
`);
    } },
  { id: 'F2a', what: 'typo: src/overrides/Buton.tsx',
    apply: (d) => fs.copyFileSync(path.join(d, BUTTON), path.join(d, 'src/overrides/Buton.tsx')) },
  { id: 'F2a-stray', what: 'stray file: src/overrides/Button.override.tsx',
    apply: (d) => fs.copyFileSync(path.join(d, BUTTON), path.join(d, 'src/overrides/Button.override.tsx')) },
  { id: 'F2b', what: 'SDK upgraded to 2.0.0: PriceTag renamed Price, new required slot Footer',
    apply: swapSdk('acme-core-2.0.0.tgz') },
  { id: 'F3', what: 'required slot Logo has no override',
    apply: (d) => fs.rmSync(path.join(d, 'src/overrides/Logo.tsx')) },
  { id: 'F4', what: 'two claims: Button.tsx + Button/index.tsx',
    apply: (d) => write(d, 'src/overrides/Button/index.tsx', read(d, BUTTON).replace("'../theme'", "'../../theme'")) },
  { id: 'F5', what: 'default export instead of the named `Button`',
    apply: (d) => edit(d, BUTTON, (s) => s.replace('export function Button', 'export default function Button')) },
  { id: 'F6a', what: 'installed SDK imports a default directly (1.0.0-bad-relative)',
    apply: swapSdk('acme-core-1.0.0-bad-relative.tgz') },
  { id: 'F6b', what: 'no @acme/core-slots link: the registry placeholder (an auto-installed peer) answers the socket',
    apply: (d, ws) => {
      const pkg = readJson(path.join(d, 'package.json'));
      delete pkg.dependencies['@acme/core-slots'];
      writeJson(path.join(d, 'package.json'), pkg);
      fs.rmSync(path.join(d, 'node_modules/@acme/core-slots'), { recursive: true, force: true });
      ws.npm(d, 'install', '--no-save', `${packs}/acme-core-slots-0.0.1.tgz`);
    } },
  { id: 'F6g', what: 'app code imports @acme/core/original/Button (bypass)',
    apply: (d) => {
      write(d, 'src/Legacy.tsx', "import { Button } from '@acme/core/original/Button';\nexport const Legacy = () => <Button>legacy</Button>;\n");
      edit(d, 'src/App.tsx', (s) => s.replace("import { ThemeProvider } from './theme';", "import { ThemeProvider } from './theme';\nimport { Legacy } from './Legacy';").replace('<Button variant="primary">Sign in</Button>', '<Button variant="primary">Sign in</Button>\n          <Legacy />'));
    } },
  { id: 'F6h', what: 'override deleted without regenerating (PriceTag.tsx removed, old shim left)',
    apply: (d) => fs.rmSync(path.join(d, 'src/overrides/PriceTag.tsx')) },
  { id: 'F7', what: 'override imports its own slot through the barrel',
    apply: (d) => edit(d, BUTTON, (s) => s.replace("from '@acme/core/original/Button'", "from '@acme/core'")) },
  { id: 'F7-transitive', what: 'override -> helper -> namespace import of the barrel uses Sdk.Button',
    apply: (d) => {
      write(d, 'src/components/Fancy.tsx', "import * as Sdk from '@acme/core';\nexport const Fancy = (p: { children?: React.ReactNode }) => <Sdk.Button>{p.children}</Sdk.Button>;\n");
      edit(d, BUTTON, (s) => `import { Fancy } from '../components/Fancy';\n${s.replace('<Original {...props} />', '<Original {...props} /><Fancy>x</Fancy>')}`);
    } },
  { id: 'F8', what: 'the SDK brings its own React (1.0.0-nested-react)',
    apply: swapSdk('acme-core-1.0.0-nested-react.tgz') },
  { id: 'F9b', what: 'client-slot override imports server-only',
    apply: (d) => edit(d, BUTTON, (s) => `import 'server-only';\n${s}`) },
  { id: 'F9c', what: 'async override in a client slot',
    apply: (d) => edit(d, BUTTON, (s) => s.replace('export function Button', 'export async function Button').replace('const theme = useTheme();', "const theme = 'dark';").replace("import { useTheme } from '../theme';\n", '')) },
];

export const byId = Object.fromEntries(MISTAKES.map((m) => [m.id, m]));
