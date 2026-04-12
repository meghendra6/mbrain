import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { VERSION } from '../version.ts';

const MARKER_START = '<!-- GBRAIN:RULES:START -->';
const MARKER_END = '<!-- GBRAIN:RULES:END -->';
const MARKER_VERSION_RE = /<!-- gbrain-agent-rules-version: ([\d.]+) -->/;

interface DetectedClient {
  name: 'claude' | 'codex';
  configDir: string;
  targetFile: string;
  mcpRegistered: boolean;
}

export async function runSetupAgent(args: string[]) {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const forceClaudeOnly = args.includes('--claude');
  const forceCodexOnly = args.includes('--codex');
  const printOnly = args.includes('--print');
  const jsonOutput = args.includes('--json');
  const skipMcp = args.includes('--skip-mcp');

  // Load the agent rules from the gbrain package
  const rulesContent = loadAgentRules();
  if (!rulesContent) {
    console.error('Could not find docs/GBRAIN_AGENT_RULES.md in the gbrain package.');
    process.exit(1);
  }

  if (printOnly) {
    console.log(formatRulesBlock(rulesContent));
    return;
  }

  // Detect installed clients
  const clients: DetectedClient[] = [];

  const claudeDir = join(home, '.claude');
  const codexDir = join(home, '.codex');

  if (!forceCodexOnly && existsSync(claudeDir)) {
    clients.push({
      name: 'claude',
      configDir: claudeDir,
      targetFile: join(claudeDir, 'CLAUDE.md'),
      mcpRegistered: checkMcpRegistered('claude', home),
    });
  }

  if (!forceClaudeOnly && existsSync(codexDir)) {
    clients.push({
      name: 'codex',
      configDir: codexDir,
      targetFile: join(codexDir, 'AGENTS.md'),
      mcpRegistered: checkMcpRegistered('codex', home),
    });
  }

  if (clients.length === 0) {
    console.error('No AI clients detected. Expected ~/.claude/ or ~/.codex/ to exist.');
    console.error('Install Claude Code or Codex first, then rerun: gbrain setup-agent');
    process.exit(1);
  }

  const results: Array<{ client: string; mcp: string; rules: string }> = [];

  for (const client of clients) {
    // Step 1: MCP registration
    let mcpStatus = 'already_registered';
    if (!client.mcpRegistered && !skipMcp) {
      mcpStatus = registerMcp(client.name);
    } else if (skipMcp) {
      mcpStatus = 'skipped';
    }

    // Step 2: Inject agent rules
    const rulesStatus = injectRules(client, rulesContent);

    results.push({ client: client.name, mcp: mcpStatus, rules: rulesStatus });
  }

  // Report
  if (jsonOutput) {
    console.log(JSON.stringify({ status: 'ok', version: VERSION, clients: results }));
  } else {
    console.log('\ngbrain setup-agent complete:\n');
    for (const r of results) {
      const clientLabel = r.client === 'claude' ? 'Claude Code' : 'Codex';
      const mcpIcon = r.mcp === 'registered' ? '+' : r.mcp === 'already_registered' ? '=' : '-';
      const rulesIcon = r.rules === 'injected' || r.rules === 'updated' ? '+' : '=';
      console.log(`  ${clientLabel}:`);
      console.log(`    [${mcpIcon}] MCP: ${r.mcp}`);
      console.log(`    [${rulesIcon}] Rules: ${r.rules}`);
    }
    console.log('\nDone. Start a new session in your AI client to activate the rules.');
    console.log('Full reference: docs/GBRAIN_SKILLPACK.md');
  }
}

function loadAgentRules(): string | null {
  const candidates = [
    join(process.cwd(), 'docs', 'GBRAIN_AGENT_RULES.md'),
    join(__dirname, '..', '..', 'docs', 'GBRAIN_AGENT_RULES.md'),
    join(__dirname, '..', 'docs', 'GBRAIN_AGENT_RULES.md'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf-8');
    }
  }

  return null;
}

function checkMcpRegistered(client: 'claude' | 'codex', home: string): boolean {
  if (client === 'claude') {
    // Check ~/.claude.json and ~/.claude/server.json for gbrain MCP entry
    const paths = [
      join(home, '.claude.json'),
      join(home, '.claude', 'server.json'),
    ];
    for (const p of paths) {
      if (existsSync(p)) {
        try {
          const content = readFileSync(p, 'utf-8');
          if (content.includes('"gbrain"')) return true;
        } catch { /* ignore read errors */ }
      }
    }
    // Also check via `claude mcp list` if available
    try {
      const out = execSync('claude mcp list 2>/dev/null', { encoding: 'utf-8', timeout: 5000 });
      if (out.split('\n').some(line => /\bgbrain\b/.test(line))) return true;
    } catch { /* command not found or failed */ }
    return false;
  }

  if (client === 'codex') {
    // Check codex config for gbrain MCP entry
    try {
      const out = execSync('codex mcp list 2>/dev/null', { encoding: 'utf-8', timeout: 5000 });
      if (out.split('\n').some(line => /\bgbrain\b/.test(line))) return true;
    } catch { /* command not found or failed */ }
    return false;
  }

  return false;
}

function registerMcp(client: 'claude' | 'codex'): string {
  const cmd = client === 'claude'
    ? 'claude mcp add gbrain -- gbrain serve'
    : 'codex mcp add gbrain -- gbrain serve';

  try {
    execSync(cmd, { encoding: 'utf-8', timeout: 15000, stdio: 'pipe' });
    return 'registered';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`  Warning: could not register MCP for ${client}: ${msg}`);
    console.warn(`  Run manually: ${cmd}`);
    return 'failed';
  }
}

function injectRules(client: DetectedClient, rulesContent: string): string {
  const block = formatRulesBlock(rulesContent);

  if (!existsSync(client.targetFile)) {
    atomicWrite(client.targetFile, block + '\n');
    return 'injected';
  }

  const existing = readFileSync(client.targetFile, 'utf-8');

  if (existing.includes(MARKER_START)) {
    const startIdx = existing.indexOf(MARKER_START);
    const endIdx = existing.indexOf(MARKER_END);

    // If end marker is missing or appears before start, treat as malformed -- append fresh
    if (endIdx === -1 || endIdx < startIdx) {
      const separator = existing.endsWith('\n') ? '\n' : '\n\n';
      atomicWrite(client.targetFile, existing + separator + block + '\n');
      return 'injected';
    }

    const existingVersion = extractVersion(existing);
    const newVersion = extractVersion(rulesContent);

    if (existingVersion === newVersion) {
      return 'up_to_date';
    }

    const before = existing.substring(0, startIdx);
    const after = existing.substring(endIdx + MARKER_END.length);
    atomicWrite(client.targetFile, before + block + after);
    return 'updated';
  }

  const separator = existing.endsWith('\n') ? '\n' : '\n\n';
  atomicWrite(client.targetFile, existing + separator + block + '\n');
  return 'injected';
}

function formatRulesBlock(rulesContent: string): string {
  return `${MARKER_START}\n${rulesContent}\n${MARKER_END}`;
}

function extractVersion(content: string): string | null {
  // Scope search to the gbrain marker region if markers exist
  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);
  const region = (startIdx !== -1 && endIdx !== -1) ? content.slice(startIdx, endIdx) : content;
  const match = region.match(MARKER_VERSION_RE);
  return match ? match[1] : null;
}

function atomicWrite(targetPath: string, content: string): void {
  const tmp = targetPath + '.gbrain.tmp';
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, targetPath);
}
