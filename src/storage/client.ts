import { config } from '../config.js';

// Server-side HTTP client for seai.storage. Service credentials never leave
// this module: callers pass tenant scope, headers are attached here.
export interface TenantScope {
  customerId: string;
  websiteId?: string | null;
}

export interface StorageResult {
  status: number;
  body: any;
}

function baseUrl(): string {
  return config.storageServiceUrl.replace(/\/$/, '');
}

export function serviceHeaders(scope?: TenantScope | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-seai-service': config.storageServiceName,
    'x-seai-service-key': config.storageServiceKey,
  };
  if (scope?.customerId) headers['x-on-behalf-of-customer'] = scope.customerId;
  if (scope?.websiteId) headers['x-on-behalf-of-website'] = scope.websiteId;
  return headers;
}

function configured(): void {
  if (!config.storageServiceKey) {
    throw Object.assign(new Error('Storage service is not configured'), { statusCode: 503 });
  }
}

async function call(path: string, init: RequestInit, scope?: TenantScope | null): Promise<StorageResult> {
  configured();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { ...serviceHeaders(scope), ...(init.headers ?? {}) },
      signal: controller.signal,
    });
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch (err) {
    throw Object.assign(new Error('Storage service unavailable'), {
      statusCode: 503,
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Map storage errors to safe user-facing messages (never leak provider internals). */
export function storageErrorMessage(result: StorageResult, fallback: string): string {
  const upstream = typeof result.body?.error === 'string' ? result.body.error : '';
  switch (result.status) {
    case 400:
      return upstream || 'Invalid file request';
    case 401:
    case 403:
      return 'Storage authorization failed';
    case 404:
      return 'Not found';
    case 409:
      return upstream || 'File is not in a state that allows this action';
    case 410:
      return 'Upload session expired — please start a new upload';
    case 413:
      return 'File is too large';
    case 422:
      return upstream || 'File did not pass safety checks';
    case 429:
      return 'Too many requests — please try again shortly';
    default:
      return fallback;
  }
}

export const storage = {
  initiateUpload(scope: TenantScope, payload: Record<string, unknown>): Promise<StorageResult> {
    return call('/api/v1/uploads', { method: 'POST', body: JSON.stringify(payload) }, scope);
  },
  completeUpload(scope: TenantScope, fileId: string): Promise<StorageResult> {
    return call(`/api/v1/uploads/${encodeURIComponent(fileId)}/complete`, { method: 'POST', body: '{}' }, scope);
  },
  async putBytes(scope: TenantScope, fileId: string, bytes: Buffer, contentType: string): Promise<StorageResult> {
    configured();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(`${baseUrl()}/api/v1/uploads/${encodeURIComponent(fileId)}/bytes`, {
        method: 'PUT',
        headers: { ...serviceHeaders(scope), 'Content-Type': contentType },
        body: bytes as unknown as BodyInit,
        signal: controller.signal,
      });
      let body: any = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return { status: res.status, body };
    } catch (err) {
      throw Object.assign(new Error('Storage service unavailable'), { statusCode: 503, cause: err });
    } finally {
      clearTimeout(timer);
    }
  },
  getFile(scope: TenantScope | null, fileId: string): Promise<StorageResult> {
    return call(`/api/v1/files/${encodeURIComponent(fileId)}`, { method: 'GET' }, scope);
  },
  downloadUrl(scope: TenantScope, fileId: string): Promise<StorageResult> {
    return call(`/api/v1/files/${encodeURIComponent(fileId)}/download`, { method: 'GET' }, scope);
  },
  removeFile(scope: TenantScope, fileId: string): Promise<StorageResult> {
    return call(`/api/v1/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }, scope);
  },
  publishFile(scope: TenantScope, fileId: string): Promise<StorageResult> {
    return call(`/api/v1/files/${encodeURIComponent(fileId)}/publish`, { method: 'POST', body: '{}' }, scope);
  },
  unpublishFile(scope: TenantScope, fileId: string): Promise<StorageResult> {
    return call(`/api/v1/files/${encodeURIComponent(fileId)}/unpublish`, { method: 'POST', body: '{}' }, scope);
  },
};
