const express = require('express');
const db = require('../../config/db');
const env = require('../../config/env');
const logger = require('../../utils/logger');

// Rota pública (sem `authenticate`), pronta pra qualquer serviço de
// monitoramento de uptime externo (UptimeRobot, Better Uptime,
// healthchecks.io etc.) apontar pra ela. Sem service/repository separado —
// não há lógica de negócio pra isolar num check deste tamanho.
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    await db.raw('SELECT 1');
    return res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      nodeEnv: env.nodeEnv,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, 'Health check falhou — banco de dados inacessível');
    return res.status(503).json({ status: 'error' });
  }
});

module.exports = router;
