const fs = require('fs');
const path = require('path');
const multer = require('multer');
const AppError = require('../utils/AppError');

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

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

/**
 * Cria um middleware de upload de foto pra uma entidade (vehicles, people...).
 * Cada entidade grava num subdiretório próprio de uploads/, nomeando o
 * arquivo como "<prefix>-<id>-<timestamp>.<ext>" (nunca o nome original do
 * usuário). Extraído pra factory na segunda entidade que precisou do mesmo
 * fluxo de upload (mesmo critério de extração já usado no resto do projeto).
 */
function createPhotoUpload(dirName, prefix) {
  const dir = path.join(UPLOADS_ROOT, dirName);
  fs.mkdirSync(dir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = ALLOWED_MIME_TYPES[file.mimetype] ?? path.extname(file.originalname) ?? '';
      cb(null, `${prefix}-${req.params.id}-${Date.now()}${ext}`);
    },
  });

  return multer({
    storage,
    fileFilter: imageFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  });
}

const uploadVehiclePhoto = createPhotoUpload('vehicles', 'vehicle');
const uploadPersonPhoto = createPhotoUpload('people', 'person');

/**
 * A `photoUrl` guardada em `vehicles.photo_url` é sempre gerada pelo próprio
 * servidor (nunca vem do usuário) — mas resolvemos e confirmamos que o
 * caminho final continua dentro de UPLOADS_ROOT mesmo assim, como defesa em
 * profundidade contra path traversal.
 */
function resolveUploadPath(relativeUrl) {
  const resolved = path.join(UPLOADS_ROOT, relativeUrl.replace(/^\/uploads/, ''));
  if (!resolved.startsWith(UPLOADS_ROOT)) return null;
  return resolved;
}

// Best-effort: usado pra limpar upload órfão (vínculo 404) ou foto antiga
// substituída. Nunca deve derrubar a request por causa de um arquivo que já
// não existe mais.
//
// NÃO usar `path.isAbsolute()` pra distinguir os dois formatos aceitos aqui:
// no Windows, `path.isAbsolute('/uploads/...')` retorna `true` (path.win32
// trata qualquer string começando com `/` como "absoluta", relativa à raiz
// do drive atual) — isso fazia o unlink tentar apagar `C:\uploads\...` em
// vez do caminho real dentro de `UPLOADS_ROOT`, falhando (ENOENT) em
// silêncio. Detectar pelo prefixo `/uploads/` em vez disso.
function deleteUploadedFile(value) {
  const target = value.startsWith('/uploads/') ? resolveUploadPath(value) : value;
  if (!target) return;
  fs.unlink(target, () => {});
}

module.exports = { uploadVehiclePhoto, uploadPersonPhoto, deleteUploadedFile, UPLOADS_ROOT };
