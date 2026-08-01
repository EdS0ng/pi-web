#!/usr/bin/env node
import { effectivePiWebConfig, maxUploadBytes, requestInputWebhookSecret } from "../config.js";
import { buildApp } from "./app.js";

const { config } = effectivePiWebConfig();
const requestInputSecret = requestInputWebhookSecret(process.env, config);
const app = await buildApp({
  bodyLimit: maxUploadBytes(process.env, config),
  ...(requestInputSecret === undefined ? {} : { requestInputSecret }),
});
await app.listen({ port: config.port ?? 8504, host: config.host ?? "127.0.0.1" });
