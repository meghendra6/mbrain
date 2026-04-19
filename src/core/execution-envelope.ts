import type { MBrainConfig } from './config.ts';
import { resolveOfflineProfile } from './offline-profile.ts';

export type BaselineFamily =
  | 'repeated_work'
  | 'markdown_retrieval'
  | 'context_map'
  | 'governance'
  | 'provenance_trace'
  | 'local_performance'
  | 'scope_isolation';

export interface ContractSurfaceStatus {
  status: 'supported' | 'unsupported';
  reason?: string;
}

export interface ExecutionEnvelope {
  mode: 'standard' | 'local_offline';
  markdownCanonical: true;
  derivedArtifactsRegenerable: true;
  baselineFamilies: BaselineFamily[];
  publicContract: {
    files: ContractSurfaceStatus;
    checkUpdate: ContractSurfaceStatus;
  };
  parity: {
    requiresSemanticAlignment: true;
    supportedEngines: Array<MBrainConfig['engine']>;
  };
}

const BASELINE_FAMILIES: BaselineFamily[] = [
  'repeated_work',
  'markdown_retrieval',
  'context_map',
  'governance',
  'provenance_trace',
  'local_performance',
  'scope_isolation',
];

function toSurfaceStatus(status: { supported: boolean; reason?: string }): ContractSurfaceStatus {
  return status.supported ? { status: 'supported' } : { status: 'unsupported', reason: status.reason };
}

function isLocalPathExecution(config: MBrainConfig, profileMode: ExecutionEnvelope['mode']): boolean {
  return profileMode === 'local_offline' || config.engine === 'pglite';
}

function localPathSurfaceReason(surface: 'files' | 'checkUpdate', engine: MBrainConfig['engine']): string {
  if (surface === 'files') {
    return engine === 'pglite'
      ? 'files/storage commands require raw Postgres access and are not supported in pglite/local mode.'
      : 'files/storage commands require Postgres raw database access and are not supported in sqlite/local mode.';
  }

  return 'check-update is disabled in the local/offline profile.';
}

export function buildExecutionEnvelope(config: MBrainConfig): ExecutionEnvelope {
  const profile = resolveOfflineProfile(config);
  const localPath = isLocalPathExecution(config, profile.status);

  return {
    mode: localPath ? 'local_offline' : profile.status,
    markdownCanonical: true,
    derivedArtifactsRegenerable: true,
    baselineFamilies: [...BASELINE_FAMILIES],
    publicContract: {
      files: localPath
        ? { status: 'unsupported', reason: localPathSurfaceReason('files', config.engine) }
        : toSurfaceStatus(profile.capabilities.files),
      checkUpdate: localPath
        ? { status: 'unsupported', reason: localPathSurfaceReason('checkUpdate', config.engine) }
        : toSurfaceStatus(profile.capabilities.check_update),
    },
    parity: {
      requiresSemanticAlignment: true,
      supportedEngines: ['postgres', 'sqlite', 'pglite'],
    },
  };
}
