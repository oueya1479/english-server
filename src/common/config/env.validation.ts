import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),

  SUPABASE_URL: Joi.string().uri().required(),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().required(),
  SUPABASE_ANON_KEY: Joi.string().optional(),

  OPENAI_API_KEY: Joi.string().required(),

  CLOUDINARY_CLOUD_NAME: Joi.string().optional(),

  FIREBASE_CREDENTIALS: Joi.string().optional(),

  REDIS_URL: Joi.string().optional(),

  ADMIN_API_KEY: Joi.string().optional(),
});
