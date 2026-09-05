const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

// Configuración central de la base de datos
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'telemetry_db',
  user: process.env.DB_USER || 'telemetry',
  password: process.env.DB_PASSWORD || '',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Manejador de errores del pool
pool.on('error', (err) => {
  console.error('Error inesperado en el pool de conexiones', err);
  process.exit(-1);
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};
