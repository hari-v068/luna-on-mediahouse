import * as dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  GAME_API_KEY: z.string().min(1),
  ACP_GAME_API_KEY: z.string().min(1),

  LUNA_PRIVATE_KEY: z.string().min(1),
  LUNA_ENTITY_ID: z.string().min(1),
  LUNA_WALLET_ADDRESS: z.string().min(1),

  SUPABASE_URL: z.string().min(1),
  SUPABASE_KEY: z.string().min(1),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error("ERROR:", _env.error.format());
  throw new Error("INCOMPLETE/INVALID ENV");
}

export const env = _env.data;
