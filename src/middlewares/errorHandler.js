const multer = require('multer');
const AppError = require('../utils/AppError');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? 'A imagem deve ter no máximo 5MB.' : 'Não foi possível processar o arquivo enviado.';
    return res.status(400).json({ error: message });
  }

  console.error(err);
  return res.status(500).json({ error: 'Erro interno do servidor' });
}

module.exports = errorHandler;
