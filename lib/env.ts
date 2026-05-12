type RequiredVariable =
  | 'DATABASE_URL'
  | 'JWT_SECRET'
  | 'JWT_REFRESH_SECRET'
  | 'STORAGE_URL'
  | 'R2_ACCOUNT_ID'
  | 'R2_ACCESS_KEY_ID'
  | 'R2_SECRET_ACCESS_KEY'
  | 'R2_BUCKET';

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
  R2_ACCOUNT_ID: readEnv('R2_ACCOUNT_ID'),
  R2_ACCESS_KEY_ID: readEnv('R2_ACCESS_KEY_ID'),
  R2_SECRET_ACCESS_KEY: readEnv('R2_SECRET_ACCESS_KEY'),
  R2_BUCKET: readEnv('R2_BUCKET'),
  R2_ENDPOINT: process.env.R2_ENDPOINT,
};
