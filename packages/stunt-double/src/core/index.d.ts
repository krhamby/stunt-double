// Types for stunt-double/core: the pure core every adapter wraps.

/** stunt-double.config.json (or package.json "stuntDouble"). Every key is optional. */
export interface StuntDoubleConfig {
  /** SDK package name. Default: auto-detected (the one dependency that ships a slot-manifest.json). */
  sdk?: string | null;
  /** Default "src/overrides". One file per overridden slot: <Slot>.tsx or <Slot>/index.tsx. */
  overridesDir?: string;
  /**
   * The ONE generated directory: gen/<Slot>.jsx|.d.ts shims, check.ts, tsconfig.check.json, state. It ignores
   * itself in git. Default ".stunt-double"; in the universal tier (a link dependency on the slot package) it is
   * the linked stub's directory (e.g. "sdk-slots") and must not be set to anything else.
   */
  outDir?: string | null;
  /** App tsconfig. Default: tsconfig.json, or the referenced config of a solution-style tsconfig.json. */
  tsconfig?: string | null;
  /** Package NAME of the gate compiler. Default "typescript"; e.g. "typescript5" (npm alias of typescript@5.9). */
  typescript?: string;
  /** Emit "use client" in client-slot shims: "auto" (when an RSC runtime is a dependency), true or false. */
  rsc?: 'auto' | boolean;
  /** Brand layer packages (spec 4.5), lowest first. */
  layers?: string[];
  /** Per-slot options: an implementation outside the overrides dir, a different export name, props opt-outs. */
  map?: Record<string, { from?: string; export?: string; ignoresProps?: string[] }>;
  /** Globs (relative to the root) allowed to import '<sdk>/original/*' outside the overrides dir. */
  allowOriginalImports?: string[];
  /** Packages that must resolve to one install (F8). Default ["react", "react-dom"] (+ the SDK and layers). */
  singletons?: string[];
  /** node_modules packages the F7 walk descends into. */
  scanPackages?: string[];
  /** "error" (the default and only value in 0.1): SDK files importing their own defaults are [F6]. */
  relativeEdges?: 'error';
  /** Directories scanned for '<sdk>/original/*' bypasses (F6g). Default ["src"]. */
  sourceDirs?: string[];
}

export interface GenerateOptions extends StuntDoubleConfig {
  /** Project root. Default: process.cwd(). */
  root?: string;
  /** What to do with problems: throw a StuntDoubleError, write poisoned shims, or just return them. Default "return". */
  onError?: 'throw' | 'poison' | 'return';
  /** false = validate only, write nothing. Default true. */
  write?: boolean;
  /** Explicit config file (relative to root). */
  configFile?: string;
}

export interface SlotMeta {
  export?: string;
  kind?: 'client' | 'shared' | 'server';
  default?: string;
  required?: boolean;
  consumers?: string[];
  renamedFrom?: string[];
}

export interface SlotManifest {
  schema: 1;
  stuntDouble?: string;
  sdk: string;
  version: string;
  abi?: string | null;
  slotPackage: string;
  originalSpecifier?: string;
  slots: Record<string, SlotMeta>;
  removedSlots?: Record<string, string>;
}

export interface Sdk {
  name: string;
  version: string;
  /** Package directory as resolved (node_modules/<sdk>). */
  dir: string;
  realDir: string;
  manifestFile: string;
  manifest: SlotManifest;
  hash: string;
  abi: string | null;
  slotPackage: string;
  originalSpecifier: string;
  slots: Record<string, SlotMeta>;
  slotNames: string[];
  removedSlots: Record<string, string>;
  defaultFile(slot: string): string | null;
  exportOf(slot: string): string;
}

export interface Layer {
  name: string;
  version: string;
  dir: string;
  realDir: string;
  slots: Record<string, { file: string; export: string; spec: string }>;
}

export interface Implementation {
  source: 'app' | 'layer' | 'sdk';
  file: string;
  export: string;
  /** module specifier (layers and SDK defaults) */
  spec?: string;
  layer?: string;
  via?: 'file' | 'map';
  ignoresProps: string[];
}

export interface SlotEntry {
  slot: string;
  kind: 'client' | 'shared' | 'server';
  required: boolean;
  exportName: string;
  /** [app claim?, layer impls (last listed first)?, SDK default?] */
  chain: Implementation[];
  /** chain[0], or null (F3) */
  impl: Implementation | null;
  /** the top implementation imports the next one down (wraps it) */
  wraps: boolean;
}

/** The generated project: result of generate(). Adapters keep it and call regenerate() on changes. */
export interface Project {
  toolVersion: string;
  root: string;
  cfg: Required<StuntDoubleConfig>;
  configFile: string | null;
  configSource: string;
  opts: GenerateOptions;
  /** posix path relative to the root */
  rel(file: string): string;
  overridesDir: string;
  /** the one generated directory (default <root>/.stunt-double) */
  outDir: string;
  /** <outDir>/gen: the shims */
  genDir: string;
  /** <outDir>/check.ts */
  checkFile: string;
  /** <outDir>/tsconfig.check.json: the type gate's tsconfig (extends the app tsconfig) */
  checkTsconfig: string;
  mapFile: string;
  stateFile: string;
  /** 'adapter' (default) or 'universal' (the slot package is linked to outDir) */
  tier: 'adapter' | 'universal';
  /** the universal tier's link dependency, or null */
  link: { field: string; spec: string; linkForm: boolean; dir: string | null } | null;
  pm: string;
  isPnP: boolean;
  rsc: boolean;
  /** Injection errors ([F1]..[F9], [CFG], [SETUP], ...). Non-empty = the build must fail. */
  problems: string[];
  /** Warnings ([W7]). Never fail the build. */
  warnings: string[];
  /** Absolute paths written by this generation (only changed bytes are written). */
  changedFiles: string[];
  /** Shims were poisoned (onError "poison" with problems). */
  poisoned: boolean;
  /** null when the SDK manifest could not be loaded (then problems explain why). */
  sdk: Sdk | null;
  layers: Layer[];
  table: Record<string, SlotEntry>;
  /** slot names */
  slots: string[];
  /** [sdk name, ...layer names]: what must never be externalized or duplicated */
  packages: string[];
  /** '<sdk>/original/<Slot>' for every slot with a default (+ layer impl specifiers): optimizeDeps.include */
  originals: string[];
  /** slot -> realpaths of SDK/layer files importing '<slotPackage>/<slot>' */
  socketConsumers: Record<string, string[]>;
  /** realpath of a default (or layer) implementation file -> slot */
  defaultFileToSlot: Map<string, string>;
  closureFiles: Set<string>;
  implFiles: string[];
  tsconfig: string | null;
  tsconfigRel: string | null;
  /** the app tsconfig's own program contains the check file (opt-in: `stunt-double init --editor`) */
  tsconfigCoversCheckFile: boolean;
  linkDeclared: boolean;
  /** hash of every decision; folded into persistent cache keys */
  fingerprint: string;
  state: Record<string, unknown> | null;
  genDirRegex: RegExp;
  /** <genDir>/<Slot>.jsx */
  shimFile(slot: string): string;
  /** id lies in the gen dir or the overrides dir (must never be pre-bundled) */
  isProjectSlotFile(id: string): boolean;
  /** a change to this file can change the generation result */
  watches(file: string): boolean;
  /** file may import the default/layer implementation of slot (shim, overrides, layers, allowOriginalImports) */
  mayImportImpl(file: string, slot: string): boolean;
  ms: number;
}

export declare class StuntDoubleError extends Error {
  problems: string[];
  constructor(message: string, problems?: string[]);
}

/** STA + emit. Synchronous: callable from any tool's config file. */
export declare function generate(opts?: GenerateOptions): Project;
/** Re-run generate() with the same options (plus overrides). */
export declare function regenerate(p: Project, overrides?: Partial<GenerateOptions>): Project;

export interface GateResult {
  ok: boolean;
  ms?: number;
  version?: string;
  /** formatted, ready to print / pass to this.error */
  message?: string;
  /** one line per mapped diagnostic */
  lines?: string[];
  output?: string;
}
/** TYP: spawn tsc (resolved by package name) on the check program. Memoized per process + fingerprint. */
export declare function runTypeGate(p: Project, opts?: { force?: boolean }): Promise<GateResult>;
export declare function resolveTypeScript(p: Project): { name: string; version: string; major: number; bin: string } | { error: string };
export declare function writeCheckTsconfig(p: Project): string;

export interface GraphModule { id: string; importers: string[] }
/** AUD: post-bundle module-graph audit. Returns problems ([F6], [F8]). */
export declare function auditGraph(p: Project, graph: GraphModule[]): string[];
export declare function rollupGraph(ctx: { getModuleIds(): Iterable<string>; getModuleInfo(id: string): { importers?: readonly string[]; dynamicImporters?: readonly string[] } | null }): GraphModule[];
export declare function webpackGraph(compilation: any, modules: Iterable<any>): GraphModule[];
export declare function esbuildGraph(metafile: { inputs: Record<string, { imports?: Array<{ path: string; external?: boolean }> }> }, root: string): GraphModule[];

export declare const DEFAULT_OUT_DIR: '.stunt-double';
export declare const CHECK_FILE: 'check.ts';
export declare const CHECK_TSCONFIG: 'tsconfig.check.json';
/** Base URL of the docs that report footers link to. */
export declare const DOCS_BASE: string;
/** Reference URL for a message code ("F2", "SDK1", ...), or null. */
export declare function docsUrl(code: string): string | null;
/** One "see <url>" line per distinct code among the lines. */
export declare function docsFooter(lines: string[]): string[];
/** header + lines + docs footer, joined for printing. */
export declare function formatReport(head: string, lines: string[]): string;
export declare function formatProblems(p: Project | null, problems?: string[]): string;
export declare function formatWarnings(p: Project | null, warnings?: string[]): string;
export declare function header(p: Project | null, n: number, what?: string): string;
export declare function parseTscOutput(output: string): Array<{ file: string | null; line: number; col: number; category: string; code: string; message: string }>;
export declare function mapDiagnostics(p: Project, output: string, map: { file: string; lines: Record<number, { role: string; slot?: string; file?: string }> } | null): string[];

export declare function watchProject(p: Project, opts?: { onChange?: (next: Project | null, prev: Project, error?: unknown) => void; debounce?: number; onError?: 'poison' | 'return' }): { close(): void; readonly current: Project };

export interface SdkLintResult { ok: boolean; errors: string[]; warnings: string[]; written: string[]; manifest?: SlotManifest; pkgDir?: string }
/**
 * The SDK publish gate. fix: first point published .d.ts files at the originals instead of the socket package
 * (rule SDK6). write: also writes consumers, the ABI pin and stunt-double.schema.json.
 */
export declare function sdkLint(pkgDir?: string, opts?: { write?: boolean; fix?: boolean }): SdkLintResult;
/** Rewrite the SDK's published declarations so they never mention the socket package. */
export declare function rewriteSocketDts(o: { pkgDir: string; pkg: any; manifest: SlotManifest }): { written: string[]; errors: string[] };
export declare function rewriteDtsFile(o: { file: string; pkgDir: string; manifest: SlotManifest; contracts: string | null }): { text: string; changed: boolean; errors: string[] };
export declare function socketMentions(file: string, slotPackage: string, src?: string): Array<{ spec: string; line: number }>;
export declare function publishedDtsFiles(pkgDir: string, pkg: any): string[];
export declare function contractsDts(pkgDir: string, pkg: any): string | null;
export declare function abiOf(manifest: SlotManifest, contractsText: string, slotPackage: string, version: string): string;
export declare function contractSlots(contractsDts: string): string[] | null;
export declare function schemaFor(manifest: SlotManifest): object;

export declare const DEFAULTS: Readonly<Required<StuntDoubleConfig>>;
export declare const CONFIG_FILE: 'stunt-double.config.json';
export declare const PACKAGE_KEY: 'stuntDouble';
export declare const TOOL_VERSION: string;
export declare const MANIFEST_FILE: 'slot-manifest.json';
export declare function loadConfig(root: string, overrides?: Partial<GenerateOptions>): { cfg: Required<StuntDoubleConfig>; configFile: string | null; configSource: string; problems: string[] };
export declare function detectPackageManager(root: string): string;
export declare function detectPnP(root: string): boolean;
export declare function detectRsc(root: string, setting: 'auto' | boolean): boolean;
export declare function loadSdk(root: string, cfg: StuntDoubleConfig): { sdk: Sdk | null; problems: string[] };
export declare function loadLayers(root: string, cfg: StuntDoubleConfig, sdk: Sdk): { layers: Layer[]; problems: string[] };
export declare function detectSdk(root: string): string[];

export declare function scanOverrides(o: { root: string; sdk: Sdk; cfg: StuntDoubleConfig; overridesDir: string; configSource?: string }): {
  claims: Map<string, Array<{ slot: string; file: string; export: string | null; via: 'file' | 'map'; ignoresProps?: string[] }>>;
  problems: string[];
  ignored: string[];
};
export declare function unknownSlotMessage(o: { sdk: Sdk; name: string; where: string; ext?: string; overridesRel: string }): string;
export declare function buildPlan(o: any): { table: Record<string, SlotEntry>; problems: string[]; warnings: string[]; closureFiles: Set<string> };
export declare function describeChain(entry: SlotEntry, rel: (f: string) => string): string;
export declare function walkImplementation(o: {
  root: string; entry: string; slot: string; exportName: string; sdk: string; slotPkg: string; kind: string;
  consumers?: string[]; scanPackages?: string[]; tsconfig?: string | null;
}): { errors: string[]; warnings: string[]; files: string[] };
export declare function scanDist(o: any): { problems: string[]; edges: Array<{ file: string; spec: string; slot: string; how: string }>; socketConsumers: Record<string, string[]>; unknownSockets: Array<{ file: string; slot: string }>; files: string[]; directives: Record<string, string | null> };
export declare function checkWiring(o: any): { problems: string[]; linkDeclared: boolean };
export declare function linkDeclaration(root: string, slotPackage: string): { field: string; spec: string; linkForm: boolean; dir: string | null } | null;
export declare function checkSingletons(o: any): string[];
export declare function scanBypass(o: any): string[];
export declare function renderCheckFile(o: any): { text: string; map: { file: string; lines: Record<number, { role: string; slot?: string; file?: string }> } };
export declare function emitAll(p: Project, check: { text: string; map: object }): string[];
export declare function emitPoison(p: Project, problems: string[]): string[];
export declare function shimFor(p: Project, slot: string): { js: string; dts: string } | null;
export declare function gitignoreFor(p: Pick<Project, 'tier'>): string;
export declare const OUT_DIR_ENTRIES: ReadonlySet<string>;
/** The app tsconfig owning the overrides (solution-style aware). */
export declare function pickAppTsconfig(root: string, explicit: string | null | undefined, overridesDir: string): string | null;
export declare function tsconfigCovers(tsconfigFile: string, absFile: string): boolean;
export declare function readTsconfig(file: string): any;
export declare function parseModule(file: string): any;
export declare function parseSource(file: string, src: string): any;
export declare function readDirective(src: string): 'use client' | 'use server' | null;
export declare function esc(s: string): string;
export declare function poisonText(s: string, max?: number): string;
export declare function nearest(name: string, candidates: string[], max?: number): string | undefined;
export declare function lev(a: string, b: string): number;
export declare function globToRegExp(glob: string): RegExp;
export declare function parseJsonc(text: string): any;
