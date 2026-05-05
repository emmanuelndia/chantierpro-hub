import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const STORAGE_SIGNED_URL_TTL_SECONDS = 15 * 60;
const MOCK_STORAGE_BASE_URL =
  process.env.STORAGE_URL?.replace(/\/+$/, '') ?? 'https://storage.example.com/chantierpro';

type StorageConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
  bucket: string;
};

let ensuredBucketPromise: Promise<void> | null = null;

export function getStorageConfig(): StorageConfig | null {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim();

  if (!supabaseUrl || !serviceRoleKey || !bucket) {
    return null;
  }

  return {
    supabaseUrl,
    serviceRoleKey,
    bucket,
  };
}

export function getStorageClient(): SupabaseClient | null {
  const config = getStorageConfig();

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
  const client = getStorageClient();

  if (!config || !client) {
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
  const client = getStorageClient();

  if (!config || !client) {
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
  const client = getStorageClient();

  if (!config || !client) {
    const expiresAt = Math.floor(Date.now() / 1000) + STORAGE_SIGNED_URL_TTL_SECONDS;
    const pathname = `${MOCK_STORAGE_BASE_URL}/${encodeURIComponent(storageKey)}`;
    const signature = signMockUrl(pathname, expiresAt);
    return `${pathname}?expires=${expiresAt}&signature=${signature}`;
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

export async function removePrivateStorageObject(storageKey: string) {
  const config = getStorageConfig();
  const client = getStorageClient();

  if (!config || !client) {
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

function getMockSigningSecret() {
  return (
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
