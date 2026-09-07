const multer = require('multer');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    // 'warn', não 'error': é uma resposta 4xx esperada (validação, regra de
    // negócio), não uma falha da aplicação — não precisa do stack completo.
    logger.warn({ err, statusCode: err.statusCode }, err.message);
    return res.status(err.statusCode).json({ error: err.message });
  }

  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? 'A imagem deve ter no máximo 5MB.' : 'Não foi possível processar o arquivo enviado.';
    logger.warn({ err }, message);
    return res.status(400).json({ error: message });
  }

  logger.error({ err }, 'Erro não tratado');
  return res.status(500).json({ error: 'Erro interno do servidor' });
}

module.exports = errorHandler;
