const { createClient } = require('@supabase/supabase-js');
const env = require('../config/env');

const BUCKET = env.supabaseStorageBucket;
// Assinatura curta de propósito (bucket privado) — se alguém deixar uma tela
// aberta além disso, a foto só para de carregar numa próxima requisição, não
// é um problema de segurança (ver memoria.md pela decisão de bucket privado
// vs. público).
const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60; // 1h

const client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

let bucketEnsured = false;

// Idempotente, tipo "CREATE DATABASE IF NOT EXISTS" — não faz sentido checar
// isso a cada boot da API (o bucket não muda depois de criado uma vez), só
// tenta criar quando um upload de verdade falhar por ele não existir.
async function ensureBucketExists() {
  if (bucketEnsured) return;
  const { error } = await client.storage.createBucket(BUCKET, { public: false });
  // "The resource already exists" é esperado a partir da segunda vez —
  // qualquer outro erro deve propagar.
  if (error && !/already exists/i.test(error.message)) {
    throw error;
  }
  bucketEnsured = true;
}

async function uploadPhoto(path, buffer, mimetype) {
  const attempt = () => client.storage.from(BUCKET).upload(path, buffer, { contentType: mimetype, upsert: true });

  let { error } = await attempt();
  if (error && /bucket not found/i.test(error.message)) {
    await ensureBucketExists();
    ({ error } = await attempt());
  }
  if (error) throw error;
}

// Best-effort — nunca deve derrubar a request por causa de uma foto antiga
// que já não existe mais no bucket (mesmo espírito do antigo
// deleteUploadedFile, só que assíncrono/contra o Storage em vez do disco).
async function deletePhoto(path) {
  if (!path) return;
  await client.storage.from(BUCKET).remove([path]).catch(() => {});
}

async function getSignedUrls(paths) {
  if (!paths.length) return new Map();
  const { data, error } = await client.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_EXPIRES_IN_SECONDS);
  if (error || !data) return new Map();
  return new Map(data.filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]));
}

/**
 * Recebe DTOs cujo `photoUrl` ainda é o CAMINHO cru no bucket (não uma URL
 * de verdade — ver comentário em people.service.js/vehicles.service.js
 * toDTO()), assina em lote só os que têm foto, e devolve os mesmos DTOs com
 * `photoUrl` já como URL assinada (ou `null` se a assinatura falhar). Só
 * deve ser chamado DEPOIS de paginar/filtrar os resultados — assinar URL de
 * um registro que nem vai ser devolvido pro cliente seria trabalho jogado
 * fora.
 */
async function attachSignedPhotoUrls(dtos) {
  const paths = [...new Set(dtos.filter((dto) => dto?.photoUrl).map((dto) => dto.photoUrl))];
  if (!paths.length) return dtos;

  const signedByPath = await getSignedUrls(paths);
  return dtos.map((dto) => (dto?.photoUrl ? { ...dto, photoUrl: signedByPath.get(dto.photoUrl) ?? null } : dto));
}

module.exports = { uploadPhoto, deletePhoto, getSignedUrls, attachSignedPhotoUrls };
