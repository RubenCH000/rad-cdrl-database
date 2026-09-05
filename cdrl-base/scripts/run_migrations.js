const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function ejecutarMigracion() {
  const cliente = new Client({
    host: 'localhost',
    user: 'cdrl_dev',
    password: 'cdrl_dev_only',
    database: 'cdrl',
    port: 5432,
  });

  try {
    await cliente.connect();
    const rutaSql = path.join(__dirname, '../db/migrations/001_initial_schema.sql');
    const sql = fs.readFileSync(rutaSql, 'utf8');
    
    await cliente.query(sql);
    console.log("Tablas creadas exitosamente.");
  } catch (error) {
    console.error("Error creando tablas:", error);
  } finally {
    await cliente.end();
  }
}

ejecutarMigracion();