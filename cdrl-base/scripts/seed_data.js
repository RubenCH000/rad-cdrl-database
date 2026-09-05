const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function ejecutarSeed() {
  const cliente = new Client({
    host: 'localhost',
    user: 'cdrl_dev',
    password: 'cdrl_dev_only',
    database: 'cdrl',
    port: 5432,
  });

  try {
    await cliente.connect();
    const rutaSql = path.join(__dirname, '../db/seed/seed_data.sql');
    const sql = fs.readFileSync(rutaSql, 'utf8');
    
    await cliente.query(sql);
    console.log("Datos insertados exitosamente.");
  } catch (error) {
    console.error("Error insertando datos:", error);
  } finally {
    await cliente.end();
  }
}

ejecutarSeed();