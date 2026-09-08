const { Resend } = require('resend');
const env = require('../config/env');
const logger = require('./logger');

// Resend é opcional (ver config/env.js) — "esqueci minha senha" é uma
// feature isolada, a API inteira não deve recusar subir por causa dela.
const isConfigured = Boolean(env.resendApiKey);

let client = null;
function getClient() {
  if (!client) {
    client = new Resend(env.resendApiKey);
  }
  return client;
}

/**
 * Nunca lança — o chamador (auth.service.js#forgotPassword) sempre responde
 * a mesma coisa pro cliente exista ou não a conta, então uma falha de envio
 * aqui não pode virar erro 500 (isso já vazaria informação de enumeração:
 * "esse e-mail existe mas o envio falhou" vs. "nunca chega a tentar
 * enviar"). Falha vira só um log no servidor, nunca um retorno visível.
 *
 * Interface pequena de propósito — só esta função exportada — pra trocar de
 * provedor exigir mudar só este arquivo por dentro, nada em quem o chama
 * (já usada uma vez: este arquivo começou com SMTP/nodemailer e trocou pra
 * Resend sem tocar em auth.service.js).
 */
async function sendPasswordResetEmail({ to, resetUrl }) {
  if (!isConfigured) {
    // Loga o link no console do servidor (nunca num retorno HTTP) — dá pra
    // testar o fluxo inteiro localmente sem precisar configurar o Resend de
    // verdade, sem abrir mão do "nunca revela ao chamador" (isso aqui só
    // quem tem acesso ao terminal do backend vê).
    logger.warn('RESEND_API_KEY não configurada — e-mail de recuperação de senha NÃO enviado (ver RESEND_API_KEY em .env)');
    logger.warn(`Link de recuperação (${to}): ${resetUrl}`);
    return;
  }

  try {
    const { error } = await getClient().emails.send({
      from: env.emailFrom,
      to,
      subject: 'Recuperação de senha — Sistema de Gestão de Portaria',
      html: `
        <p>Foi solicitada a recuperação de senha da sua conta no Sistema de Gestão de Portaria.</p>
        <p><a href="${resetUrl}">Clique aqui para definir uma nova senha</a></p>
        <p>Se você não pediu essa recuperação, ignore este e-mail — sua senha continua a mesma.</p>
        <p>Este link expira em breve e só pode ser usado uma vez.</p>
      `,
    });
    // O SDK do Resend não lança em erro de API (ex.: remetente/destinatário
    // não permitido no modo de teste) — devolve `{ error }` no retorno.
    if (error) {
      logger.error({ err: error }, 'Falha ao enviar e-mail de recuperação de senha (Resend)');
    }
  } catch (err) {
    logger.error({ err }, 'Falha ao enviar e-mail de recuperação de senha');
  }
}

module.exports = { sendPasswordResetEmail };
