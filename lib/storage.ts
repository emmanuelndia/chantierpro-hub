import { createHash, createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const STORAGE_SIGNED_URL_TTL_SECONDS = 15 * 60;
const MOCK_STORAGE_BASE_URL =
  process.env.STORAGE_URL?.replace(/\/+$/, '') ?? 'https://storage.example.com/chantierpro';
const R2_REGION = 'auto';
const S3_SERVICE = 's3';
const EMPTY_PAYLOAD_HASH = sha256Hex('');

type R2StorageConfig = {
  provider: 'r2';
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

type SupabaseStorageConfig = {
  provider: 'supabase';
  supabaseUrl: string;
  serviceRoleKey: string;
  bucket: string;
};

type StorageConfig = R2StorageConfig | SupabaseStorageConfig;

let ensuredBucketPromise: Promise<void> | null = null;

export function getStorageConfig(): StorageConfig | null {
  const r2Config = getR2StorageConfig();
  if (r2Config) {
    return r2Config;
  }

  return getSupabaseStorageConfig();
}

function getR2StorageConfig(): R2StorageConfig | null {
  const bucket = process.env.R2_BUCKET?.trim() ?? process.env.CLOUDFLARE_R2_BUCKET?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() ?? process.env.CLOUDFLARE_R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey =
    process.env.R2_SECRET_ACCESS_KEY?.trim() ?? process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY?.trim();
  const endpointFromEnv = process.env.R2_ENDPOINT?.trim() ?? process.env.CLOUDFLARE_R2_ENDPOINT?.trim();
  const accountId = process.env.R2_ACCOUNT_ID?.trim() ?? process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const endpoint = endpointFromEnv ?? (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null);

  if (!bucket || !accessKeyId || !secretAccessKey || !endpoint) {
    return null;
  }

  return {
    provider: 'r2',
    endpoint: endpoint.replace(/\/+$/, ''),
    bucket,
    accessKeyId,
    secretAccessKey,
  };
}

function getSupabaseStorageConfig(): SupabaseStorageConfig | null {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim();

  if (!supabaseUrl || !serviceRoleKey || !bucket) {
    return null;
  }

  return {
    provider: 'supabase',
    supabaseUrl,
    serviceRoleKey,
    bucket,
  };
}

export function getStorageClient(): SupabaseClient | null {
  const config = getSupabaseStorageConfig();

  if (!config) {
    return null;
  }

  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function ensurePrivateStorageBucket() {
  const config = getStorageConfig();

  if (!config || config.provider === 'r2') {
    return;
  }

  const client = getStorageClient();

  if (!client) {
    return;
  }

  ensuredBucketPromise ??= (async () => {
    const { data: buckets, error: listError } = await client.storage.listBuckets();

    if (!listError && buckets?.some((bucket) => bucket.name === config.bucket)) {
      return;
    }

    await client.storage.createBucket(config.bucket, {
      public: false,
    });
  })();

  return ensuredBucketPromise;
}

export async function uploadPrivateStorageObject(payload: {
  storageKey: string;
  body: Buffer;
  contentType: string;
}) {
  const config = getStorageConfig();

  if (!config) {
    return {
      url: `mock-storage://${payload.storageKey}`,
    };
  }

  if (config.provider === 'r2') {
    await uploadR2Object(config, payload);
    return {
      url: `r2://${config.bucket}/${payload.storageKey}`,
    };
  }

  const client = getStorageClient();
  if (!client) {
    return {
      url: `mock-storage://${payload.storageKey}`,
    };
  }

  await ensurePrivateStorageBucket();

  const { error } = await client.storage.from(config.bucket).upload(payload.storageKey, payload.body, {
    contentType: payload.contentType,
    upsert: false,
  });

  if (error) {
    throw error;
  }

  return {
    url: `supabase://${config.bucket}/${payload.storageKey}`,
  };
}

export async function createSignedStorageUrl(storageKey: string) {
  const config = getStorageConfig();

  if (!config) {
    const expiresAt = Math.floor(Date.now() / 1000) + STORAGE_SIGNED_URL_TTL_SECONDS;
    const pathname = `${MOCK_STORAGE_BASE_URL}/${encodeURIComponent(storageKey)}`;
    const signature = signMockUrl(pathname, expiresAt);
    return `${pathname}?expires=${expiresAt}&signature=${signature}`;
  }

  if (config.provider === 'r2') {
    return createPresignedR2Url(config, storageKey, STORAGE_SIGNED_URL_TTL_SECONDS);
  }

  const client = getStorageClient();
  if (!client) {
    throw new Error('Unable to create storage client');
  }

  const { data, error } = await client
    .storage
    .from(config.bucket)
    .createSignedUrl(storageKey, STORAGE_SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    throw error ?? new Error('Unable to create Supabase signed URL');
  }

  return data.signedUrl;
}

export async function fetchPrivateStorageObject(storageKey: string) {
  const config = getStorageConfig();

  if (!config) {
    return fetch(await createSignedStorageUrl(storageKey), { cache: 'no-store' });
  }

  if (config.provider === 'r2') {
    const url = buildR2ObjectUrl(config, storageKey);
    const headers = signR2HeaderRequest(config, {
      method: 'GET',
      url,
      payloadHash: EMPTY_PAYLOAD_HASH,
    });

    return fetch(url, {
      cache: 'no-store',
      headers,
    });
  }

  return fetch(await createSignedStorageUrl(storageKey), { cache: 'no-store' });
}

export async function removePrivateStorageObject(storageKey: string) {
  const config = getStorageConfig();

  if (!config) {
    return;
  }

  if (config.provider === 'r2') {
    await deleteR2Object(config, storageKey);
    return;
  }

  const client = getStorageClient();
  if (!client) {
    return;
  }

  const { error } = await client.storage.from(config.bucket).remove([storageKey]);

  if (error) {
    throw error;
  }
}

export function getSignedStorageUrlTtlSeconds() {
  return STORAGE_SIGNED_URL_TTL_SECONDS;
}

async function uploadR2Object(
  config: R2StorageConfig,
  payload: {
    storageKey: string;
    body: Buffer;
    contentType: string;
  },
) {
  const payloadHash = sha256Hex(payload.body);
  const url = buildR2ObjectUrl(config, payload.storageKey);
  const headers = signR2HeaderRequest(config, {
    method: 'PUT',
    url,
    payloadHash,
    contentType: payload.contentType,
  });

  const response = await fetch(url, {
    method: 'PUT',
    body: new Uint8Array(payload.body),
    headers,
  });

  if (!response.ok) {
    throw new Error(`R2 upload failed with status ${response.status}: ${await response.text()}`);
  }
}

async function deleteR2Object(config: R2StorageConfig, storageKey: string) {
  const url = buildR2ObjectUrl(config, storageKey);
  const headers = signR2HeaderRequest(config, {
    method: 'DELETE',
    url,
    payloadHash: EMPTY_PAYLOAD_HASH,
  });

  const response = await fetch(url, {
    method: 'DELETE',
    headers,
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`R2 delete failed with status ${response.status}: ${await response.text()}`);
  }
}

function createPresignedR2Url(config: R2StorageConfig, storageKey: string, expiresSeconds: number) {
  const now = new Date();
  const amzDate = formatAmzDate(now);
  const shortDate = amzDate.slice(0, 8);
  const credentialScope = buildCredentialScope(shortDate);
  const url = buildR2ObjectUrl(config, storageKey);
  const parsedUrl = new URL(url);

  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  });
  const canonicalQuery = canonicalizeSearchParams(query);
  const canonicalRequest = [
    'GET',
    parsedUrl.pathname,
    canonicalQuery,
    `host:${parsedUrl.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = hmacHex(getSigningKey(config.secretAccessKey, shortDate), stringToSign);

  query.set('X-Amz-Signature', signature);
  return `${url}?${canonicalizeSearchParams(query)}`;
}

function signR2HeaderRequest(
  config: R2StorageConfig,
  payload: {
    method: 'GET' | 'PUT' | 'DELETE';
    url: string;
    payloadHash: string;
    contentType?: string;
  },
) {
  const now = new Date();
  const amzDate = formatAmzDate(now);
  const shortDate = amzDate.slice(0, 8);
  const credentialScope = buildCredentialScope(shortDate);
  const parsedUrl = new URL(payload.url);
  const headers: Record<string, string> = {
    host: parsedUrl.host,
    'x-amz-content-sha256': payload.payloadHash,
    'x-amz-date': amzDate,
  };

  if (payload.contentType) {
    headers['content-type'] = payload.contentType;
  }

  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key]}\n`)
    .join('');
  const canonicalRequest = [
    payload.method,
    parsedUrl.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payload.payloadHash,
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = hmacHex(getSigningKey(config.secretAccessKey, shortDate), stringToSign);

  return {
    ...headers,
    Authorization: [
      'AWS4-HMAC-SHA256',
      `Credential=${config.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', '),
  };
}

function buildR2ObjectUrl(config: R2StorageConfig, storageKey: string) {
  return `${config.endpoint}/${encodePathSegment(config.bucket)}/${encodeStorageKey(storageKey)}`;
}

function buildCredentialScope(shortDate: string) {
  return `${shortDate}/${R2_REGION}/${S3_SERVICE}/aws4_request`;
}

function getSigningKey(secretAccessKey: string, shortDate: string) {
  const dateKey = hmacBuffer(`AWS4${secretAccessKey}`, shortDate);
  const dateRegionKey = hmacBuffer(dateKey, R2_REGION);
  const dateRegionServiceKey = hmacBuffer(dateRegionKey, S3_SERVICE);
  return hmacBuffer(dateRegionServiceKey, 'aws4_request');
}

function canonicalizeSearchParams(params: URLSearchParams) {
  return [...params.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey),
    )
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&');
}

function encodeStorageKey(storageKey: string) {
  return storageKey.split('/').map(encodePathSegment).join('/');
}

function encodePathSegment(value: string) {
  return encodeRfc3986(value);
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function formatAmzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function sha256Hex(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function hmacBuffer(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value).digest();
}

function hmacHex(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value).digest('hex');
}

function getMockSigningSecret() {
  return (
    process.env.R2_SECRET_ACCESS_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.JWT_SECRET ??
    'chantierpro-photo-mock-signature-secret'
  );
}

function signMockUrl(pathname: string, expiresAt: number) {
  return createHmac('sha256', getMockSigningSecret())
    .update(`${pathname}:${expiresAt}`)
    .digest('hex');
}
