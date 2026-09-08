/**
 * Valida CPF pelo algoritmo padrão de dígito verificador (mod 11, dois
 * dígitos) — mesmo princípio de is_valid_cnpj() no Postgres (gate_schema.sql),
 * só que replicado em Node porque people.cpf_encrypted é criptografado: o
 * Postgres não teria como validar via CHECK constraint (não consegue
 * descriptografar o valor pra checar).
 */
function isValidCpf(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length !== 11) return false;
  // Todos os dígitos iguais (ex.: 111.111.111-11) passam no cálculo do dígito
  // verificador mas nunca são CPFs reais emitidos — bloqueados à parte.
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const checkDigit = (base) => {
    let sum = 0;
    let weight = base.length + 1;
    for (const char of base) {
      sum += Number(char) * weight;
      weight -= 1;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const base = digits.slice(0, 9);
  const digit1 = checkDigit(base);
  const digit2 = checkDigit(base + digit1);

  return digits === `${base}${digit1}${digit2}`;
}

module.exports = { isValidCpf };
