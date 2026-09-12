const multer = require('multer');
const AppError = require('../utils/AppError');

const ALLOWED_MIME_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

function imageFileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES[file.mimetype]) {
    return cb(new AppError('Apenas imagens JPEG, PNG ou WEBP são permitidas.', 400));
  }
  return cb(null, true);
}

// memoryStorage: sem escrita em disco — o buffer (req.file.buffer) vai
// direto pro Supabase Storage (ver utils/supabaseStorage.js), o multer só
// valida tipo/tamanho e recebe os bytes na memória do processo.
function createPhotoUpload() {
  return multer({
    storage: multer.memoryStorage(),
    fileFilter: imageFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  });
}

// Continuam duas instâncias nomeadas (em vez de uma só compartilhada) pra
// não precisar tocar em people.routes.js/vehicles.routes.js — hoje são
// idênticas, já que a diferença de destino (pasta people/ vs vehicles/) virou
// responsabilidade de buildPhotoPath(), não do multer.
const uploadVehiclePhoto = createPhotoUpload();
const uploadPersonPhoto = createPhotoUpload();
const uploadAccessLogPhoto = createPhotoUpload();

// Nome do objeto no bucket: "<dirName>/<prefix>-<id>-<timestamp>.<ext>" —
// mesmo formato de nome já usado quando os uploads ficavam em disco, agora
// como chave dentro do Supabase Storage em vez de caminho de arquivo (nunca
// o nome original enviado pelo usuário).
function buildPhotoPath(dirName, prefix, id, mimetype) {
  const ext = ALLOWED_MIME_TYPES[mimetype] ?? '';
  return `${dirName}/${prefix}-${id}-${Date.now()}${ext}`;
}

module.exports = { uploadVehiclePhoto, uploadPersonPhoto, uploadAccessLogPhoto, buildPhotoPath };
