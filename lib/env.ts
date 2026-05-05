type RequiredVariable =
  | 'DATABASE_URL'
  | 'JWT_SECRET'
  | 'JWT_REFRESH_SECRET'
  | 'STORAGE_URL'
  | 'SUPABASE_URL'
  | 'SUPABASE_SERVICE_ROLE_KEY'
  | 'SUPABASE_STORAGE_BUCKET';

function readEnv(name: RequiredVariable) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export const env = {
  DATABASE_URL: readEnv('DATABASE_URL'),
  JWT_SECRET: readEnv('JWT_SECRET'),
  JWT_REFRESH_SECRET: readEnv('JWT_REFRESH_SECRET'),
  STORAGE_URL: readEnv('STORAGE_URL'),
  SUPABASE_URL: readEnv('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: readEnv('SUPABASE_SERVICE_ROLE_KEY'),
  SUPABASE_STORAGE_BUCKET: readEnv('SUPABASE_STORAGE_BUCKET'),
};
