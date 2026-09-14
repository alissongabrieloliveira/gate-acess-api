const { generateGatewayToken } = require('../../utils/gatewayToken');

/**
 * Provisionamento MVP do gateway local (ver memória do projeto
 * "gate-controller-project"): sem tela de admin ainda, só este script.
 * Idempotente, mesmo critério do seed 001 — rodar de novo não duplica nada.
 *
 * Cria (se ainda não existir) 1 gateway_devices ativo pra empresa e as
 * linhas de gate_direction_outputs pra cancela de ENTRADA (N saídas
 * acionadas juntas, ex.: 2 braços de cancela) e de SAÍDA (normalmente 1
 * saída). O token bruto só é impresso na criação — não há como reobtê-lo
 * depois (só o hash fica no banco).
 *
 * `host`/`port`/`ns` (endereço de rede da controladora física) também são
 * gravados aqui — é isso que permite reconfigurar o gateway remotamente
 * (rodar este seed de novo com valores novos, inclusive contra o banco de
 * produção via Railway CLI) sem precisar de acesso físico/remoto à máquina
 * do cliente. Por isso `ensureOutputs` faz um UPSERT de verdade: se a
 * saída já existe, atualiza o endereço em vez de só pular.
 */
function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Seed abortado: variável de ambiente obrigatória ausente: ${name}. ` +
        'Configure o provisionamento do gateway no .env (ver .env.example) antes de rodar "npm run seed".'
    );
  }
  return value;
}

function parseOutputNumbers(raw, label) {
  const numbers = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);

  if (numbers.length === 0 || numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 4)) {
    throw new Error(`Seed abortado: ${label} precisa ser uma lista de números entre 1 e 4 separados por vírgula (ex.: "1,2"), recebeu "${raw}"`);
  }
  return numbers;
}

exports.seed = async function seed(knex) {
  const companyCnpj = requiredEnv('SEED_COMPANY_CNPJ');
  const deviceName = process.env.SEED_GATEWAY_DEVICE_NAME || 'Gateway Principal';
  const entryOutputs = parseOutputNumbers(process.env.SEED_GATEWAY_ENTRY_OUTPUTS || '1,2', 'SEED_GATEWAY_ENTRY_OUTPUTS');
  const exitOutputs = parseOutputNumbers(process.env.SEED_GATEWAY_EXIT_OUTPUTS || '3', 'SEED_GATEWAY_EXIT_OUTPUTS');
  const host = requiredEnv('SEED_GATEWAY_HOST');
  const port = Number(process.env.SEED_GATEWAY_PORT || 5000);
  const ns = requiredEnv('SEED_GATEWAY_NS');

  if (ns.length !== 5) {
    throw new Error(`Seed abortado: SEED_GATEWAY_NS precisa ter exatamente 5 caracteres, recebeu "${ns}"`);
  }

  const cleanCnpj = companyCnpj.replace(/[^0-9]/g, '');

  await knex.transaction(async (trx) => {
    const company = await trx('companies').where({ cnpj: cleanCnpj }).first();
    if (!company) {
      throw new Error(
        `Seed abortado: nenhuma empresa encontrada com CNPJ "${companyCnpj}" — rode o seed 001 (empresa/admin inicial) primeiro.`
      );
    }

    let device = await trx('gateway_devices')
      .where({ company_id: company.id })
      .whereNull('revoked_at')
      .first();

    if (device) {
      console.log(`[seed] Gateway já provisionado (id=${device.id}) — token não é reimpresso (só existe uma vez, na criação)`);
    } else {
      const { raw, hash } = generateGatewayToken();
      const [inserted] = await trx('gateway_devices')
        .insert({ company_id: company.id, name: deviceName, token_hash: hash })
        .returning(['id', 'name']);
      device = inserted;

      console.log('');
      console.log('==================================================================');
      console.log(`[seed] Gateway "${device.name}" criado (id=${device.id})`);
      console.log('[seed] TOKEN (copiar agora — não será exibido de novo):');
      console.log(`[seed]   ${raw}`);
      console.log('==================================================================');
      console.log('');
    }

    async function ensureOutputs(direction, outputNumbers) {
      for (const outputNumber of outputNumbers) {
        const existing = await trx('gate_direction_outputs')
          .where({ gateway_device_id: device.id, output_number: outputNumber })
          .first();

        if (existing) {
          const changed =
            existing.direction !== direction || existing.host !== host || existing.port !== port || existing.ns !== ns;
          if (!changed) {
            console.log(`[seed] Saída ${outputNumber} (${direction}) já configurada (id=${existing.id}) — endereço igual, nada a fazer`);
            continue;
          }
          await trx('gate_direction_outputs').where({ id: existing.id }).update({ direction, host, port, ns });
          console.log(
            `[seed] Saída ${outputNumber} (id=${existing.id}) reconfigurada: ${direction}, ${host}:${port}, ns=${ns}` +
              (existing.direction !== direction ? ` (direção mudou de ${existing.direction})` : '')
          );
          continue;
        }

        const [row] = await trx('gate_direction_outputs')
          .insert({
            company_id: company.id,
            gateway_device_id: device.id,
            direction,
            output_number: outputNumber,
            current_state: 'OFF',
            host,
            port,
            ns,
          })
          .returning(['id']);

        console.log(`[seed] Saída ${outputNumber} (${direction}) configurada: id=${row.id}, ${host}:${port}, ns=${ns}`);
      }
    }

    await ensureOutputs('ENTRY', entryOutputs);
    await ensureOutputs('EXIT', exitOutputs);

    console.log('[seed] Reinicie o processo do gateway para que a config nova seja aplicada (só é lida na conexão).');
  });
};
