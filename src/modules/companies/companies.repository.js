const db = require('../../config/db');

function findById(id) {
  return db('companies').where({ id }).whereNull('deleted_at').first();
}

module.exports = { findById };
