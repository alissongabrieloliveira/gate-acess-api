const nodemailer = require('nodemailer');
const env = require('../config/env');

// SMTP é opcional (ver config/env.js) — "esqueci minha senha" é uma
// feature isolada, a API inteira não deve recusar subir por causa dela.
// Considerado "configurado" só se host/usuário/senha estiverem todos
// presentes; qualquer um faltando já é tratado como "não configurado" (não
// um erro de configuração parcial).
const isConfigured = Boolean(env.smtpHost && env.smtpUser && env.smtpPassword);

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: { user: env.smtpUser, pass: env.smtpPassword },
    });
  }
  return transporter;
}

/**
 * Nunca lança — o chamador (auth.service.js#forgotPassword) sempre responde
 * a mesma coisa pro cliente exista ou não a conta, então uma falha de envio
 * aqui não pode virar erro 500 (isso já vazaria informação de enumeração:
 * "esse e-mail existe mas o envio falhou" vs. "nunca chega a tentar
 * enviar"). Falha vira só um log no servidor, nunca um retorno visível.
 *
 * Interface pequena de propósito — só esta função exportada — pra trocar
 * SMTP por outro provedor (Resend, por exemplo, considerado pro futuro)
 * exigir mudar só este arquivo por dentro, nada em quem o chama.
 */
async function sendPasswordResetEmail({ to, resetUrl }) {
  if (!isConfigured) {
    // Loga o link no console do servidor (nunca num retorno HTTP) — dá pra
    // testar o fluxo inteiro localmente sem precisar configurar SMTP de
    // verdade, sem abrir mão do "nunca revela ao chamador" (isso aqui só
    // quem tem acesso ao terminal do backend vê).
    console.error(`SMTP não configurado — e-mail de recuperação de senha NÃO enviado (ver SMTP_* em .env)`);
    console.error(`Link de recuperação (${to}): ${resetUrl}`);
    return;
  }

  try {
    await getTransporter().sendMail({
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
  } catch (err) {
    console.error('Falha ao enviar e-mail de recuperação de senha:', err.message);
  }
}

module.exports = { sendPasswordResetEmail };
