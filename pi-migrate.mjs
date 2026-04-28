#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, readdirSync, statSync, symlinkSync, chmodSync } from 'node:fs';
import { join, resolve, basename, dirname, relative } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HOME = homedir();
const DEFAULT_OUT = join(HOME, '.pi/agent/packages');
const MIGRATOR_ROOT = dirname(fileURLToPath(import.meta.url));

function usage() {
  console.log(`pi-migrate — migrate agent plugin/extension/app repos to native Pi packages\n\nUsage:\n  pi-migrate {gh-repo|url|local} [--name <pkg>] [--out <dir>] [--install] [--force]\n  pi-migrate migrate {gh-repo|url|local} [--name <pkg>] [--out <dir>] [--install] [--force]\n  pi-migrate inspect {gh-repo|url|local} [--name <pkg>]\n  pi-migrate verify <package-dir>\n\nExamples:\n  pi-migrate tirth8205/code-review-graph --install\n  pi-migrate https://github.com/tirth8205/code-review-graph --install\n  pi-migrate inspect ./my-claude-plugin\n  pi-migrate verify ~/.pi/agent/packages/code-review-graph-pi\n\nWhat it migrates now:\n  - Claude Code plugin resources: skills/ and .claude/skills -> Pi skills\n  - commands/ and .claude/commands -> Pi prompts\n  - agents/ and .claude/agents -> pi.agents (requires pi-claude-code + pi-subagents)\n  - .mcp.json MCP servers -> mcporter-generated CLI bridges + deterministic instructions\n  - Claude settings hooks -> Pi extension hooks when safely translatable\n  - CLAUDE.md / AGENTS.md -> Pi AGENTS.md package instructions\n  - Generates MIGRATION_REPORT.md and VERIFY_WITH_AGENT.md

Roadmap:
  - Codex AGENTS.md/packages, Gemini CLI extensions, OpenCode plugins, Cursor/Windsurf rules, and app bundles\n\nFlags:\n  --install       Run 'pi install <generated-package>' after migration\n  --force         Replace existing output package\n  --out <dir>     Parent output dir (default ~/.pi/agent/packages)\n  --name <name>   Output package name (default repo basename + -pi)\n`);
}

function sh(cmd, args, opts={}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}
function trySh(cmd, args, opts={}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  return { ok: r.status === 0, status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
function parseArgs(argv) {
  const out = { _: [] };
  for (let i=0;i<argv.length;i++) {
    const a=argv[i];
    if (a.startsWith('--')) {
      const k=a.slice(2);
      if (['install','force','dry-run'].includes(k)) out[k]=true;
      else out[k]=argv[++i];
    } else out._.push(a);
  }
  return out;
}
function slug(s) { return s.replace(/\.git$/,'').split('/').filter(Boolean).pop().replace(/[^a-zA-Z0-9._-]/g,'-'); }
function copyIfExists(src, dst) { if (existsSync(src)) { mkdirSync(dirname(dst), {recursive:true}); cpSync(src, dst, {recursive:true}); return true; } return false; }
function walk(dir, pred=()=>true, acc=[]) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p=join(dir,name); const st=statSync(p);
    if (st.isDirectory()) walk(p,pred,acc); else if (pred(p)) acc.push(p);
  }
  return acc;
}
function readJson(p) { try { return JSON.parse(readFileSync(p,'utf8')); } catch { return null; } }
function writeJson(p, obj) { writeFileSync(p, JSON.stringify(obj,null,2)+'\n'); }
function normalizeSource(src) {
  if (existsSync(src)) return resolve(src);
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(src)) return `https://github.com/${src.replace(/\.git$/, '')}.git`;
  return src;
}
function materializeSource(src) {
  const normalized = normalizeSource(src);
  if (existsSync(normalized)) return resolve(normalized);
  const work = join(tmpdir(), `pi-migrate-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  sh('git', ['clone','--depth','1',normalized,work]);
  return work;
}
function detect(srcRoot) {
  const dirs = {
    skills: ['skills','.claude/skills'].filter(d=>existsSync(join(srcRoot,d))),
    prompts: ['commands','.claude/commands','prompts'].filter(d=>existsSync(join(srcRoot,d))),
    agents: ['agents','.claude/agents'].filter(d=>existsSync(join(srcRoot,d))),
    extensions: ['extensions'].filter(d=>existsSync(join(srcRoot,d))),
    hooks: ['hooks','.claude/hooks'].filter(d=>existsSync(join(srcRoot,d))),
  };
  const files = {
    claudeMd: ['CLAUDE.md','.claude/CLAUDE.md'].find(f=>existsSync(join(srcRoot,f))),
    agentsMd: ['AGENTS.md'].find(f=>existsSync(join(srcRoot,f))),
    mcp: ['.mcp.json','mcp.json','mcp_servers.json'].find(f=>existsSync(join(srcRoot,f))),
    settings: ['.claude/settings.json','settings.json'].find(f=>existsSync(join(srcRoot,f))),
    pkg: ['package.json'].find(f=>existsSync(join(srcRoot,f))),
  };
  files.hookManifests = discoverHookManifests(srcRoot);
  return { dirs, files };
}

function discoverHookManifests(srcRoot) {
  const candidates = [
    '.github/hooks/planning-with-files.json',
    '.github/hooks.json',
    '.codex/hooks.json',
    '.cursor/hooks.json',
    '.gemini/settings.json',
    '.mastracode/hooks.json',
  ];
  const found = candidates.filter(f => existsSync(join(srcRoot, f)));
  if (existsSync(join(srcRoot, '.github/hooks'))) {
    for (const f of walk(join(srcRoot, '.github/hooks'), p => p.endsWith('.json'))) found.push(relative(srcRoot, f));
  }
  return [...new Set(found)];
}

function copyHookManifestsForAudit(srcRoot, hookManifests, outDir, report) {
  if (!hookManifests?.length) return null;
  const auditDir = join(outDir, 'docs', 'source-hooks');
  mkdirSync(auditDir, {recursive:true});
  for (const rel of hookManifests) {
    const src = join(srcRoot, rel);
    const dst = join(auditDir, rel.replace(/[\\/]/g, '__'));
    if (existsSync(src)) copyIfExists(src, dst);
  }
  report.migrated.push('source hook manifests -> docs/source-hooks/');
  report.warnings.push('Non-Claude hook manifests were detected and preserved for audit. Verify whether their behavior needs a bespoke native Pi extension; generic hook translation only covers Claude-style settings hooks.');
  report.partial.push({
    component: 'hooks:non-claude-manifests',
    reason: 'Source contains hook manifests outside .claude/settings.json; preserve and explicitly verify full-feature behavior in Pi',
    detail: hookManifests,
  });
  return './docs/source-hooks';
}
function ensurePiDeps() {
  const settingsPath = join(HOME,'.pi/agent/settings.json');
  const settings = readJson(settingsPath) || { packages: [] };
  const packages = settings.packages || [];
  const has = (needle) => packages.some(x => x === needle || (x && typeof x === 'object' && x.source === needle));
  return {
    piClaudeCode: has('npm:@fractary/pi-claude-code'),
    piSubagents: has('npm:pi-subagents'),
    settingsPath,
  };
}
function generateMcporterCli(serverName, toolsDir, report) {
  mkdirSync(toolsDir,{recursive:true});
  const out = join(toolsDir, `${serverName}-mcp`);
  let r = trySh('mcporter', ['generate-cli','--server',serverName,'--compile',out], { timeout: 120000 });
  if (!r.ok) {
    report.warnings.push(`mcporter compile failed for ${serverName}; trying script output. ${r.stderr.slice(0,400)}`);
    r = trySh('mcporter', ['generate-cli','--server',serverName,'--output',out], { timeout: 120000 });
  }
  if (r.ok && existsSync(out)) {
    try { chmodSync(out,0o755); } catch {}
    return out;
  }
  report.partial.push({component:`mcp:${serverName}`, reason:`mcporter generate-cli failed; use docs/MCP_CLI_FALLBACK.md for one-off mcp CLI access`, detail:(r.stderr||r.stdout).slice(0,1000)});
  return null;
}
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'"'"'`)}'`;
}
function mcpServerCommand(config) {
  if (!config || typeof config !== 'object') return null;
  if (config.url) return String(config.url);
  if (!config.command) return null;
  const env = config.env && typeof config.env === 'object'
    ? Object.entries(config.env).map(([k,v]) => `${k}=${shellQuote(v)}`).join(' ')
    : '';
  const args = Array.isArray(config.args) ? config.args.map(shellQuote).join(' ') : '';
  return [env, config.command, args].filter(Boolean).join(' ');
}
function generateMcpCliFallbackDoc(outDir, mcp, report) {
  const names = Object.keys(mcp || {});
  if (!names.length) return null;
  const docsDir = join(outDir, 'docs'); mkdirSync(docsDir, {recursive:true});
  const rows = names.map(name => ({ name, command: mcpServerCommand(mcp[name]) || '<manual server command required>' }));
  const md = `# MCP CLI Fallback\n\nPi does not expose MCP servers natively. This package first tries to generate deterministic mcporter CLI bridges in \`bin/\`. When bridge generation is unavailable or you need one-off discovery/debugging, use the \`mcp\` CLI directly.\n\n## Prerequisite\n\nThe MCP CLI should exist at \`~/.local/bin/mcp\`. If it is missing, install mcptools:\n\n\`\`\`bash\ncd /tmp && git clone --depth 1 https://github.com/f/mcptools.git\ncd mcptools && CGO_ENABLED=0 go build -o ~/.local/bin/mcp ./cmd/mcptools\nexport PATH="$HOME/.local/bin:$PATH"\n\`\`\`\n\n## Migrated MCP servers\n\n${rows.map(r => `### ${r.name}\n\nServer command:\n\n\`\`\`bash\n${r.command}\n\`\`\`\n\nDiscover tools:\n\n\`\`\`bash\nmcp tools ${r.command}\n\`\`\`\n\nDiscover schemas as JSON:\n\n\`\`\`bash\nmcp tools --format json ${r.command}\n\`\`\`\n\nCall a tool after discovery:\n\n\`\`\`bash\nmcp call <tool_name> --params '{"key":"value"}' ${r.command}\n\`\`\`\n`).join('\n')}\n## Safety workflow\n\n1. Always run \`mcp tools\` before calling a tool.\n2. Prefer \`-f json\` or \`--format json\` when parsing output.\n3. Use \`mcp guard\` for destructive-capable servers.\n4. Use aliases only for a short session and remove them after use.\n`;
  const out = join(docsDir, 'MCP_CLI_FALLBACK.md');
  writeFileSync(out, md);
  report.migrated.push('mcp fallback docs -> docs/MCP_CLI_FALLBACK.md');
  return './docs/MCP_CLI_FALLBACK.md';
}
function mcpServersFromFile(root, rel) {
  if (!rel) return {};
  const json = readJson(join(root,rel));
  return json?.mcpServers || json?.servers || {};
}
function hookCommandToPiExtension(pkgName, settings, outDir, report) {
  const hooks = settings?.hooks || {};
  const hookEntries = [];
  for (const [eventName, arr] of Object.entries(hooks)) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) for (const h of (item.hooks || [])) {
      if (h?.type === 'command' && h.command) hookEntries.push({ eventName, matcher:item.matcher||'', command:h.command, timeout:h.timeout || 30000 });
    }
  }
  if (!hookEntries.length) return null;
  const isPortable = (command) => !/(^|\s)\.claude\//.test(command) && !/(^|\s)\.cursor\//.test(command);
  const supportedEvents = new Set(['PostToolUse','SessionStart','PreToolUse','SessionEnd','Stop','UserPromptSubmit','PostToolUseFailure']);
  const supported = hookEntries.filter(h => supportedEvents.has(h.eventName) && isPortable(h.command));
  const nonPortable = hookEntries.filter(h => supportedEvents.has(h.eventName) && !isPortable(h.command));
  const unsupported = hookEntries.filter(h => !supportedEvents.has(h.eventName));
  if (nonPortable.length) report.partial.push({component:'hooks', reason:'Skipped hooks that depend on project-local agent script paths such as .claude/ or .cursor/', detail:nonPortable});
  if (unsupported.length) report.partial.push({component:'hooks', reason:'Some Claude hook events have no direct Pi translation', detail:unsupported});
  if (!supported.length) return null;
  const extDir = join(outDir,'extensions'); mkdirSync(extDir,{recursive:true});
  const ext = join(extDir, `${pkgName}-hooks.ts`);
  const literal = JSON.stringify(supported, null, 2);
  writeFileSync(ext, `import { spawnSync } from "node:child_process";\n\nconst HOOKS = ${literal};\nfunction run(command: string, timeout: number) {\n  spawnSync(command, { shell: true, stdio: "ignore", timeout, env: process.env });\n}\nfunction matches(matcher: string, toolName?: string) {\n  return !matcher || (!!toolName && toolName.match(new RegExp(matcher, "i")));\n}\nexport default function(pi: any) {\n  pi.on("session_start", async () => {\n    for (const h of HOOKS.filter((x:any)=>x.eventName === "SessionStart")) run(h.command, h.timeout);\n  });\n  pi.on("before_agent_start", async () => {\n    for (const h of HOOKS.filter((x:any)=>x.eventName === "UserPromptSubmit")) run(h.command, h.timeout);\n  });\n  pi.on("tool_call", async (event) => {\n    for (const h of HOOKS.filter((x:any)=>x.eventName === "PreToolUse")) {\n      if (matches(h.matcher, event.toolName)) run(h.command, h.timeout);\n    }\n  });\n  pi.on("tool_result", async (event) => {\n    const anyEvent = event as any;\n    const failed = !!(anyEvent?.error || anyEvent?.result?.isError || anyEvent?.toolResult?.isError);\n    for (const h of HOOKS.filter((x:any)=>x.eventName === "PostToolUse")) {\n      if (matches(h.matcher, event.toolName)) run(h.command, h.timeout);\n    }\n    if (failed) for (const h of HOOKS.filter((x:any)=>x.eventName === "PostToolUseFailure")) {\n      if (matches(h.matcher, event.toolName)) run(h.command, h.timeout);\n    }\n  });\n  pi.on("session_shutdown", async () => {\n    for (const h of HOOKS.filter((x:any)=>x.eventName === "SessionEnd" || x.eventName === "Stop")) run(h.command, h.timeout);\n  });\n}\n`);
  report.migrated.push(`hooks -> ${relative(outDir,ext)}`);
  if (supported.some(h => ['SessionEnd','Stop','UserPromptSubmit','PostToolUseFailure'].includes(h.eventName))) report.migrated.push('hooks -> Pi-native lifecycle event mappings');
  return './extensions';
}
function patchSkillsForCli(outDir, bridges, fallbackDoc) {
  const skillsDir = join(outDir,'skills');
  if (!existsSync(skillsDir) || (!bridges.length && !fallbackDoc)) return;
  const bridgeList = bridges.length
    ? `\n\nDeterministic mcporter bridge commands:\n\n${bridges.map(b=>`- ${b.server}: \`${b.cli} <kebab-tool-name> [--option value] [--raw '{"json":"args"}']\``).join('\n')}`
    : '';
  const fallback = fallbackDoc ? `\n\nFor one-off discovery/debugging, or when a mcporter bridge was not generated, use the MCP CLI fallback guide: \`${fallbackDoc}\`. Start with \`mcp tools <server-command>\`, then call tools with \`mcp call <tool_name> --params '<json>' <server-command>\`.` : '';
  const intro = `\n\n## Pi MCP-to-CLI bridge\n\nPi does not expose MCP natively. Do not call native MCP tools from Pi. Use deterministic CLI access instead.${bridgeList}${fallback}\n\nAlways start with the smallest/discovery context tool when one exists. Prefer generated bridge CLIs before broad file scans, and use mcp CLI discovery before any one-off fallback call.\n`;
  for (const f of walk(skillsDir,p=>p.endsWith('SKILL.md') || p.endsWith('.md'))) {
    let text=readFileSync(f,'utf8');
    if (!text.includes('## Pi MCP-to-CLI bridge')) {
      const idx = text.startsWith('---') ? text.indexOf('\n---',3) : -1;
      if (idx>=0) text = text.slice(0, idx+4)+intro+text.slice(idx+4); else text = intro+'\n'+text;
    }
    const marker = '## Pi MCP-to-CLI bridge';
    const markerIndex = text.indexOf(marker);
    if (markerIndex >= 0) {
      const before = text.slice(0, markerIndex);
      const section = text.slice(markerIndex);
      const split = section.indexOf('\nUse ');
      if (split >= 0) {
        const generated = section.slice(0, split);
        const original = section.slice(split).replace(/MCP tools/g,'CLI bridge commands').replace(/MCP tool/g,'CLI bridge command');
        text = before + generated + original;
      } else {
        text = before + section;
      }
    } else {
      text=text.replace(/MCP tools/g,'CLI bridge commands').replace(/MCP tool/g,'CLI bridge command');
    }
    writeFileSync(f,text);
  }
}
function analyzeFunctionalGaps(srcRoot, d, report) {
  const pkg = d.files.pkg ? readJson(join(srcRoot, d.files.pkg)) : null;
  const textFiles = [
    ...walk(srcRoot, p => /(^|\/)(README|CLAUDE|AGENTS|CONTRIBUTING|CHANGELOG|TODO|TODOS)\.md$/i.test(p)),
    ...walk(srcRoot, p => p.endsWith('.ts') || p.endsWith('.js') || p.endsWith('.mjs')).slice(0, 80)
  ];
  const haystack = textFiles.map(p => {
    try { return readFileSync(p, 'utf8').slice(0, 20000); } catch { return ''; }
  }).join('\n');
  const hasProviderLayer = /ProviderType|DEFAULT_MODELS|createProvider|LLMProvider|provider/i.test(haystack);
  const knownAgentSet = /claude|cursor|codex|opencode|github-copilot/i.test(haystack);
  const hasCliInitAgent = /--agent|targetAgent|detectAgents|writeSetup|writers\//i.test(haystack);
  if (hasProviderLayer) {
    report.partial.push({component:'functional:provider-adapter', reason:'Source appears to implement its own provider/model layer; Pi package wiring alone is insufficient', detail:'Verify or add a Pi provider adapter that inherits Pi default provider/model/auth instead of requiring separate API keys.'});
  }
  if (knownAgentSet && hasCliInitAgent) {
    report.partial.push({component:'functional:pi-agent-target', reason:'Source appears to generate per-agent config but may not support Pi as a target', detail:'Verify CLI/init flows accept `pi` and write Pi-compatible outputs (global ~/.pi/agent package resources, or AGENTS.md/.agents skills when project-local).'});
  }
  if (pkg?.bin) {
    report.partial.push({component:'functional:cli-runtime', reason:'Source exposes CLI command(s); migrated package should preserve the normal CLI behavior, not only Pi resources', detail:pkg.bin});
  }
}
function applyRuntimeAdapters(outDir, pkgName, src, report) {
  if (!/caliber|ai-setup/i.test(`${pkgName} ${src}`)) return;
  const binDir = join(outDir, 'bin'); mkdirSync(binDir, {recursive:true});
  writeFileSync(join(binDir, 'pi'), `#!/usr/bin/env bash
set -euo pipefail
prompt=""
if [ "$#" -eq 0 ]; then
  prompt="$(cat)"
else
  args=()
  skip=0
  for arg in "$@"; do
    case "$arg" in
      --print|-p|--no-session|--no-context-files|--no-skills|--no-prompt-templates) ;;
      --model|--provider|--api-key|--mode|--tools|--thinking) skip=1 ;;
      *) if [ "$skip" = 1 ]; then skip=0; else args+=("$arg"); fi ;;
    esac
  done
  prompt="\${args[*]}"
  if [ ! -t 0 ]; then stdin="$(cat)"; prompt="$prompt
$stdin"; fi
fi
exec pi --print --no-session --no-context-files --no-skills --no-prompt-templates "$prompt"
`);
  writeFileSync(join(binDir, 'opencode'), `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  auth)
    if [ "\${2:-}" = "status" ]; then echo "Authenticated via Pi default auth"; exit 0; fi
    ;;
  run)
    shift
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --format|--model) shift 2 ;;
        --) shift; break ;;
        *) shift ;;
      esac
    done
    prompt="$(cat)"
    exec "$(dirname "$0")/pi" --print "$prompt"
    ;;
esac
echo "opencode shim for Caliber Pi adapter" >&2
exit 0
`);
  writeFileSync(join(binDir, 'caliber-pi'), `#!/usr/bin/env bash
set -euo pipefail
CALIBER_BIN="$(command -v caliber)"
SHIM_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$SHIM_DIR:$PATH"
export CALIBER_USE_PI=1
if [ "$#" -ge 1 ] && [ "$1" = "init" ]; then
  args=()
  saw_agent=0
  for arg in "$@"; do
    if [ "$saw_agent" = 1 ]; then
      arg="\${arg//pi/codex}"
      saw_agent=0
    fi
    if [ "$arg" = "--agent" ]; then saw_agent=1; fi
    args+=("$arg")
  done
  set -- "\${args[@]}"
fi
PI_PROVIDER="$(node -e "try{const s=require(process.env.HOME+'/.pi/agent/settings.json'); process.stdout.write(s.defaultProvider||'openai')}catch{process.stdout.write('openai')}" 2>/dev/null)"
PI_MODEL="$(node -e "try{const s=require(process.env.HOME+'/.pi/agent/settings.json'); process.stdout.write(s.defaultModel||'default')}catch{process.stdout.write('default')}" 2>/dev/null)"
case "\${1:-}" in
  status)
    if [ "\${2:-}" = "--json" ]; then
      printf '{\\n  "configured": true,\\n  "provider": "pi",\\n  "model": "%s",\\n  "piProvider": "%s",\\n  "piAuth": "default",\\n  "manifest": null\\n}\\n' "$PI_MODEL" "$PI_PROVIDER"
      exit 0
    fi
    echo "Caliber provider: pi (Pi default: \${PI_PROVIDER}/\${PI_MODEL}, auth: default)"
    ;;
  config)
    if [ "\${2:-}" = "--show" ]; then
      printf 'provider=pi\\nmodel=%s\\npiProvider=%s\\npiAuth=default\\n' "$PI_MODEL" "$PI_PROVIDER"
      exit 0
    fi
    ;;
esac
TMP_HOME="\${TMPDIR:-/tmp}/caliber-pi-home/home"
mkdir -p "$TMP_HOME/.caliber"
node -e "const fs=require('fs'); const home=process.argv[1]; fs.writeFileSync(home+'/.caliber/config.json', JSON.stringify({provider:'opencode', model:'default'}, null, 2)+'\\\\n')" "$TMP_HOME"
export HOME="$TMP_HOME"
export CALIBER_USE_OPENCODE=1
export CALIBER_MODEL="default"
exec "$CALIBER_BIN" "$@"
`);
  for (const f of ['pi','opencode','caliber-pi']) try { chmodSync(join(binDir, f), 0o755); } catch {}
  const readme = `# Caliber Pi Runtime Adapter

This migrated package includes a Pi adapter for Caliber.

- Effective provider: \`pi\` (reported by \`caliber status --json\` through the adapter)
- Model/auth: inherited from \`~/.pi/agent/settings.json\` and Pi's normal auth
- Init target: \`caliber init --agent pi\`
- Output target: Pi-compatible \`AGENTS.md\` and \`.agents/skills/\` via Caliber's Codex-compatible writer

Upstream Caliber does not yet have a first-class Pi provider. The adapter uses Caliber's seat-based OpenCode provider path with an \`opencode\` shim that calls \`pi --print\`.
`;
  writeFileSync(join(outDir, 'README_PI.md'), readme);
  report.migrated.push('runtime adapter -> bin/caliber-pi, bin/pi, bin/opencode');
  report.migrated.push('provider adapter -> reports provider pi and inherits Pi default model/auth');
  report.migrated.push('init adapter -> supports `caliber init --agent pi` via Pi-compatible AGENTS.md/.agents output');
  report.warnings.push('Caliber uses a runtime adapter because upstream Caliber lacks first-class Pi provider/target support. Validate normal CLI behavior, not just Pi package loading.');
  return { bin: { caliber: './bin/caliber-pi' } };
}
function generateAgentPrompt(outDir, pkgName, report) {
  const prompt = `# Verification Agent Prompt: ${pkgName}\n\nYou are verifying a Claude Code plugin migration to Pi. Work systematically and update the migration package if needed.\n\n## Context\n- Package directory: ${outDir}\n- Migration report: ${join(outDir,'MIGRATION_REPORT.md')}\n- Generated package manifest: ${join(outDir,'package.json')}\n- Pi migrator root: ${MIGRATOR_ROOT}\n- Pi supports packages via \`package.json.pi\` resources.\n- Pi does not natively expose MCP. MCP servers must be accessed through deterministic CLI bridges generated by mcporter, or through explicit one-off \`mcp\` CLI fallback commands documented by the package.\n\n## Progressive-disclosure protocol\n1. Inspect \`MIGRATION_REPORT.md\` first; do not scan everything.\n2. Verify manifest paths exist and loaded resources are minimal.\n3. For skills/prompts, inspect only files listed as partial/failed first.\n4. For MCP, run each generated bridge with \`--help\`, then one safe read-only command.\n5. For hooks, verify event translation is safe and non-destructive. If source hook manifests were preserved in \`docs/source-hooks/\`, compare them against generated Pi extension behavior and repair gaps.\n6. Only then broaden search if unresolved issues remain.\n\n## Required checks\n- \`pi list\` includes this package if installed.\n- \`package.json\` has \`keywords: [\"pi-package\"]\` and correct \`pi\` keys.\n- Skills contain Pi MCP-to-CLI instructions if they mention MCP.\n- Agents use Pi-compatible model identifiers where explicit.\n- Commands do not reference unsupported Claude namespace syntax without an adaptation note.\n- Extension commands do not shadow prompt templates unless this is intentional and documented. Prefer prefixed native commands when prompts preserve upstream slash UX.\n- Claude hooks are either translated to Pi extensions or clearly flagged.\n- Non-Claude hook manifests (GitHub Copilot, Codex, Cursor, Gemini, etc.) are either translated to native Pi behavior or clearly flagged with concrete repair steps.\n- MCP servers have generated CLI bridges, or \`docs/MCP_CLI_FALLBACK.md\` provides an \`mcp tools\` / \`mcp call\` fallback workflow and the bridge failure is listed as partial with next actions.\n- If the source has its own CLI/provider/platform system, the migrated plugin still works normally for Pi users: provider/auth/model are Pi-native and CLI init/setup flows accept Pi where applicable.\n\n## Repair mandate\nIf anything is missing or broken, fix it in-place in the package. If a pattern is generally reusable, update the migrator CLI source in ${MIGRATOR_ROOT} so future migrations improve. Then rerun verification.\n\n## Abductive learning and migrator update mandate\nAt the end of every verification/repair pass:\n1. Extract learnings from surprising failures, source-layout surprises, hook translation gaps, command-shadowing issues, and install/runtime issues.\n2. Add those learnings to \`MIGRATOR_LEARNINGS.md\` in ${MIGRATOR_ROOT}.\n3. If a learning is generalizable, update \`pi-migrate.mjs\`, \`README.md\`, or \`skills/pi-migrate/SKILL.md\` in ${MIGRATOR_ROOT}.\n4. Run \`pi-migrate verify ${outDir}\` after package repairs.\n5. If ${MIGRATOR_ROOT} is inside a git repository, run \`git status\`, commit the migrator/package changes with a clear message, and push to the configured remote. If it is not a git repo or no remote exists, report the exact commands needed instead of pretending it was pushed.\n\nUse this compact learning format:\n- surprising failure mode\n- likely cause\n- generalizable fix\n- exact CLI improvement made or proposed\n- git commit/push status\n\n## Current migration facts\n${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(join(outDir,'VERIFY_WITH_AGENT.md'), prompt);
}
function ensureMigratorLearningDoc(report) {
  const out = join(MIGRATOR_ROOT, 'MIGRATOR_LEARNINGS.md');
  const hookDetails = report?.files?.hookManifests?.length ? `
- Source hook manifests: ${report.files.hookManifests.join(', ')}` : '';
  const md = `# Migrator Learnings

Persistent learnings extracted from pi-migrate verification and repair passes. New verification agents must append compact, generalizable observations here and update the CLI when the observation is reusable.

## 2026-04-28 — Verification mandate

- Every generated \`VERIFY_WITH_AGENT.md\` now explicitly tells the verifier to extract learnings, update this file, improve \`pi-migrate.mjs\` / docs / skill instructions when generalizable, rerun verification, and commit/push when the migrator root is in a git repository.
- Verification must compare preserved non-Claude hook manifests against native Pi behavior, not assume copied skills/prompts are full-feature migrations.${hookDetails}
- Native Pi extension commands can shadow prompt templates; prompt-compatible slash UX should remain in prompts, while native convenience commands should use a prefix or be documented as intentional shadowing.
`;
  if (!existsSync(out)) writeFileSync(out, md);
}

function writeReport(outDir, report) {
  const md = `# Migration Report\n\nGenerated: ${new Date().toISOString()}\n\n## Status\n- Migrated: ${report.migrated.length}\n- Partial: ${report.partial.length}\n- Failed: ${report.failed.length}\n- Warnings: ${report.warnings.length}\n\n## Migrated\n${report.migrated.map(x=>`- ${x}`).join('\n') || '- none'}\n\n## Partial\n${report.partial.map(x=>`- **${x.component}**: ${x.reason}\n  - ${JSON.stringify(x.detail).slice(0,1000)}`).join('\n') || '- none'}\n\n## Failed\n${report.failed.map(x=>`- **${x.component}**: ${x.reason}\n  - ${String(x.detail||'').slice(0,1000)}`).join('\n') || '- none'}\n\n## Warnings\n${report.warnings.map(x=>`- ${x}`).join('\n') || '- none'}\n\n## Next step\nOpen \`VERIFY_WITH_AGENT.md\` and paste it into an agent, or run an agent with that file as context, to verify and repair this migration.\n`;
  writeFileSync(join(outDir,'MIGRATION_REPORT.md'), md);
}
function migrate(argv) {
  const a=parseArgs(argv); const src=a._[1]; if(!src) { usage(); process.exit(2); }
  const srcRoot=materializeSource(src); const base=slug(a.name||src); const pkgName=(a.name||`${base}-pi`).replace(/[^a-zA-Z0-9._-]/g,'-');
  const outParent=resolve(a.out||DEFAULT_OUT); const outDir=join(outParent,pkgName);
  if (existsSync(outDir)) { if (!a.force) { console.error(`Output exists: ${outDir} (use --force)`); process.exit(1);} rmSync(outDir,{recursive:true,force:true}); }
  mkdirSync(outDir,{recursive:true});
  const report={source:src, sourceRoot:srcRoot, outDir, migrated:[], partial:[], failed:[], warnings:[]};
  const d=detect(srcRoot);
  report.files = d.files;
  analyzeFunctionalGaps(srcRoot, d, report);
  for (const rel of d.dirs.skills) { copyIfExists(join(srcRoot,rel), join(outDir,'skills')); report.migrated.push(`${rel} -> skills`); break; }
  for (const rel of d.dirs.prompts) { copyIfExists(join(srcRoot,rel), join(outDir,'prompts')); report.migrated.push(`${rel} -> prompts`); break; }
  for (const rel of d.dirs.agents) { copyIfExists(join(srcRoot,rel), join(outDir,'agents')); report.migrated.push(`${rel} -> agents`); break; }
  for (const rel of d.dirs.extensions) { copyIfExists(join(srcRoot,rel), join(outDir,'extensions')); report.migrated.push(`${rel} -> extensions`); break; }
  copyHookManifestsForAudit(srcRoot, d.files.hookManifests, outDir, report);
  if (d.files.claudeMd) { copyIfExists(join(srcRoot,d.files.claudeMd), join(outDir,'AGENTS.md')); report.migrated.push(`${d.files.claudeMd} -> AGENTS.md`); }
  else if (d.files.agentsMd) { copyIfExists(join(srcRoot,d.files.agentsMd), join(outDir,'AGENTS.md')); report.migrated.push(`${d.files.agentsMd} -> AGENTS.md`); }
  const deps=ensurePiDeps();
  if (!deps.piClaudeCode) report.partial.push({component:'agents/tool-shims', reason:'@fractary/pi-claude-code not installed globally', detail:'Run: pi install npm:@fractary/pi-claude-code'});
  if (existsSync(join(outDir,'agents')) && !deps.piSubagents) report.partial.push({component:'agents', reason:'pi-subagents not installed', detail:'Run: pi install npm:pi-subagents'});
  const bridges=[]; const mcp=mcpServersFromFile(srcRoot,d.files.mcp);
  const fallbackDoc=generateMcpCliFallbackDoc(outDir, mcp, report);
  for (const serverName of Object.keys(mcp)) {
    const cli=generateMcporterCli(serverName, join(outDir,'bin'), report);
    if (cli) { bridges.push({server:serverName, cli:`./bin/${basename(cli)}`}); report.migrated.push(`mcp:${serverName} -> bin/${basename(cli)}`); }
  }
  if (Object.keys(mcp).length && !bridges.length) report.partial.push({component:'mcp', reason:'MCP config detected but no mcporter bridges generated; fallback doc created', detail:fallbackDoc || d.files.mcp});
  patchSkillsForCli(outDir, bridges, fallbackDoc);
  const settings=d.files.settings ? readJson(join(srcRoot,d.files.settings)) : null;
  const extPath=hookCommandToPiExtension(pkgName, settings, outDir, report);
  const runtimeAdapter=applyRuntimeAdapters(outDir, pkgName, src, report);
  const pi={};
  if (existsSync(join(outDir,'extensions'))) pi.extensions=['./extensions'];
  if (existsSync(join(outDir,'skills'))) pi.skills=['./skills'];
  if (existsSync(join(outDir,'prompts'))) pi.prompts=['./prompts'];
  if (existsSync(join(outDir,'agents'))) pi.agents=['./agents'];
  writeJson(join(outDir,'package.json'), { name:pkgName, version:'0.1.0', description:`Pi migration of ${src}`, keywords:['pi-package','claude-code-plugin','migrated'], pi, ...(runtimeAdapter||{}) });
  ensureMigratorLearningDoc(report);
  writeReport(outDir, report); generateAgentPrompt(outDir,pkgName,report);
  if (a.install) { const r=trySh('pi',['install',outDir],{timeout:120000}); if(!r.ok) { report.failed.push({component:'pi install', reason:'pi install failed', detail:r.stderr}); writeReport(outDir,report); } }
  console.log(`Migrated ${src} -> ${outDir}`);
  console.log(`Report: ${join(outDir,'MIGRATION_REPORT.md')}`);
  console.log(`Verifier prompt: ${join(outDir,'VERIFY_WITH_AGENT.md')}`);
}
function verify(argv) {
  const dir=resolve(argv[1]||'.'); const pkg=readJson(join(dir,'package.json')); const results=[];
  const ok=(n,b,d='')=>results.push([n,b,d]);
  ok('package.json', !!pkg); ok('pi manifest', !!pkg?.pi); ok('pi-package keyword', pkg?.keywords?.includes('pi-package'));
  for (const k of ['skills','prompts','agents','extensions']) if (pkg?.pi?.[k]) for (const rel of pkg.pi[k]) ok(`${k}:${rel}`, existsSync(join(dir,rel.replace(/^\.\//,''))));
  ok('migration report', existsSync(join(dir,'MIGRATION_REPORT.md'))); ok('verifier prompt', existsSync(join(dir,'VERIFY_WITH_AGENT.md')));
  for (const [n,b,d] of results) console.log(`${b?'OK':'FAIL'} ${n}${d?' '+d:''}`);
  console.log(`Summary: ${results.filter(x=>x[1]).length}/${results.length}`);
}
const argv=process.argv.slice(2); const cmd=argv[0];
if (!cmd || ['-h','--help'].includes(cmd)) usage();
else if (cmd==='migrate'||cmd==='inspect') migrate(argv);
else if (cmd==='verify') verify(argv);
else migrate(['migrate', ...argv]);
