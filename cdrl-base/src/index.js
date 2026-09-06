'use strict';

const express = require('express');
const db = require('./config/database');

const CONTRATO = {
  estadosDispositivo: ['active', 'inactive', 'maintenance'],
  severidadesAlerta: ['low', 'medium', 'high', 'critical'],
  tiposAlerta: ['temperature', 'humidity', 'battery', 'connection'],
  rangos: {
    temperature: [-50, 100],
    humidity: [0, 100],
    battery_level: [0, 100],
  },
  longitudMinimaSerie: 5,
  limitePorDefecto: 50,
  limiteMaximo: 500,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNAS_DISPOSITIVO =
  'device_id, serial_number, device_type, firmware_version, status, created_at';
const COLUMNAS_TELEMETRIA =
  'telemetry_id, device_id, timestamp, temperature, humidity, battery_level, metadata';
const COLUMNAS_ALERTA =
  'alert_id, device_id, alert_type, severity, message, triggered_at, resolved_at';

const app = express();
app.use(express.json());

app.locals.contrato = CONTRATO;

const ruta = (manejador) => (peticion, respuesta, siguiente) =>
  Promise.resolve(manejador(peticion, respuesta, siguiente)).catch(siguiente);

const esUuid = (valor) => typeof valor === 'string' && UUID.test(valor);

const esNumero = (valor) => typeof valor === 'number' && Number.isFinite(valor);

function validarRango(campo, valor, errores) {
  if (valor === undefined || valor === null) return;
  const [minimo, maximo] = CONTRATO.rangos[campo];
  if (!esNumero(valor)) {
    errores.push(`${campo} debe ser numerico`);
  } else if (valor < minimo || valor > maximo) {
    errores.push(`${campo} esta fuera del rango [${minimo}, ${maximo}]`);
  }
}

function leerLimite(peticion, errores) {
  if (peticion.query.limit === undefined) return CONTRATO.limitePorDefecto;
  const limite = Number(peticion.query.limit);
  if (!Number.isInteger(limite) || limite < 1 || limite > CONTRATO.limiteMaximo) {
    errores.push(`limit debe ser un entero entre 1 y ${CONTRATO.limiteMaximo}`);
    return null;
  }
  return limite;
}

const errorDeValidacion = (respuesta, detalles) =>
  respuesta.status(400).json({
    error: 'validation_error',
    message: 'La peticion no cumple el contrato de datos',
    details: detalles,
  });

function construirFiltros(filtros, parametros) {
  const condiciones = [];
  Object.entries(filtros).forEach(([columna, valor]) => {
    if (valor === undefined) return;
    parametros.push(valor);
    condiciones.push(`${columna} = $${parametros.length}`);
  });
  return condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
}

app.get('/health', (peticion, respuesta) => {
  respuesta.json({
    status: 'ok',
    service: 'cdrl-api',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get(
  '/ready',
  ruta(async (peticion, respuesta) => {
    try {
      await db.query('SELECT 1');
      respuesta.json({ status: 'ready', database: 'up' });
    } catch (error) {
      respuesta.status(503).json({
        status: 'unavailable',
        database: 'down',
        message: 'La base de datos no responde',
      });
    }
  })
);

app.get(
  '/api/devices',
  ruta(async (peticion, respuesta) => {
    const errores = [];
    const limite = leerLimite(peticion, errores);
    const { status } = peticion.query;
    if (status !== undefined && !CONTRATO.estadosDispositivo.includes(status)) {
      errores.push(`status debe ser uno de: ${CONTRATO.estadosDispositivo.join(', ')}`);
    }
    if (errores.length) return errorDeValidacion(respuesta, errores);

    const parametros = [];
    const filtro = construirFiltros({ status }, parametros);
    parametros.push(limite);

    const { rows } = await db.query(
      `SELECT ${COLUMNAS_DISPOSITIVO} FROM devices ${filtro} ` +
        `ORDER BY created_at DESC LIMIT $${parametros.length}`,
      parametros
    );
    respuesta.json({ data: rows, count: rows.length });
  })
);

app.post(
  '/api/devices',
  ruta(async (peticion, respuesta) => {
    const cuerpo = peticion.body || {};
    const errores = [];

    if (
      typeof cuerpo.serial_number !== 'string' ||
      cuerpo.serial_number.trim().length < CONTRATO.longitudMinimaSerie
    ) {
      errores.push(
        `serial_number es obligatorio y requiere al menos ${CONTRATO.longitudMinimaSerie} caracteres`
      );
    }
    if (typeof cuerpo.device_type !== 'string' || cuerpo.device_type.trim() === '') {
      errores.push('device_type es obligatorio');
    }
    const estado = cuerpo.status === undefined ? 'active' : cuerpo.status;
    if (!CONTRATO.estadosDispositivo.includes(estado)) {
      errores.push(`status debe ser uno de: ${CONTRATO.estadosDispositivo.join(', ')}`);
    }
    if (errores.length) return errorDeValidacion(respuesta, errores);

    const { rows } = await db.query(
      `INSERT INTO devices (serial_number, device_type, firmware_version, status)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNAS_DISPOSITIVO}`,
      [
        cuerpo.serial_number.trim(),
        cuerpo.device_type.trim(),
        cuerpo.firmware_version === undefined ? null : cuerpo.firmware_version,
        estado,
      ]
    );
    respuesta.status(201).json({ data: rows[0] });
  })
);

app.get(
  '/api/devices/:deviceId',
  ruta(async (peticion, respuesta) => {
    if (!esUuid(peticion.params.deviceId)) {
      return errorDeValidacion(respuesta, ['device_id debe ser un UUID valido']);
    }
    const { rows } = await db.query(
      `SELECT ${COLUMNAS_DISPOSITIVO} FROM devices WHERE device_id = $1`,
      [peticion.params.deviceId]
    );
    if (rows.length === 0) {
      return respuesta.status(404).json({
        error: 'not_found',
        message: 'El dispositivo no existe',
      });
    }
    respuesta.json({ data: rows[0] });
  })
);

app.get(
  '/api/telemetry',
  ruta(async (peticion, respuesta) => {
    const errores = [];
    const limite = leerLimite(peticion, errores);
    const deviceId = peticion.query.device_id;
    if (deviceId !== undefined && !esUuid(deviceId)) {
      errores.push('device_id debe ser un UUID valido');
    }
    if (errores.length) return errorDeValidacion(respuesta, errores);

    const parametros = [];
    const filtro = construirFiltros({ device_id: deviceId }, parametros);
    parametros.push(limite);

    const { rows } = await db.query(
      `SELECT ${COLUMNAS_TELEMETRIA} FROM telemetry_data ${filtro} ` +
        `ORDER BY timestamp DESC LIMIT $${parametros.length}`,
      parametros
    );
    respuesta.json({ data: rows, count: rows.length });
  })
);

app.post(
  '/api/telemetry',
  ruta(async (peticion, respuesta) => {
    const cuerpo = peticion.body || {};
    const errores = [];

    if (!esUuid(cuerpo.device_id)) {
      errores.push('device_id es obligatorio y debe ser un UUID valido');
    }

    const marcaTiempo =
      cuerpo.timestamp === undefined ? new Date().toISOString() : cuerpo.timestamp;
    if (typeof marcaTiempo !== 'string' || Number.isNaN(Date.parse(marcaTiempo))) {
      errores.push('timestamp debe ser una fecha ISO 8601 valida');
    }

    validarRango('temperature', cuerpo.temperature, errores);
    validarRango('humidity', cuerpo.humidity, errores);
    validarRango('battery_level', cuerpo.battery_level, errores);
    if (esNumero(cuerpo.battery_level) && !Number.isInteger(cuerpo.battery_level)) {
      errores.push('battery_level debe ser un entero');
    }
    if (
      cuerpo.metadata !== undefined &&
      (typeof cuerpo.metadata !== 'object' ||
        cuerpo.metadata === null ||
        Array.isArray(cuerpo.metadata))
    ) {
      errores.push('metadata debe ser un objeto JSON');
    }
    if (errores.length) return errorDeValidacion(respuesta, errores);

    const { rows } = await db.query(
      `INSERT INTO telemetry_data (device_id, timestamp, temperature, humidity, battery_level, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNAS_TELEMETRIA}`,
      [
        cuerpo.device_id,
        marcaTiempo,
        cuerpo.temperature ?? null,
        cuerpo.humidity ?? null,
        cuerpo.battery_level ?? null,
        cuerpo.metadata ?? {},
      ]
    );
    respuesta.status(201).json({ data: rows[0] });
  })
);

app.get(
  '/api/alerts',
  ruta(async (peticion, respuesta) => {
    const errores = [];
    const limite = leerLimite(peticion, errores);
    const { device_id: deviceId, severity, alert_type: tipoAlerta } = peticion.query;

    if (deviceId !== undefined && !esUuid(deviceId)) {
      errores.push('device_id debe ser un UUID valido');
    }
    if (severity !== undefined && !CONTRATO.severidadesAlerta.includes(severity)) {
      errores.push(`severity debe ser uno de: ${CONTRATO.severidadesAlerta.join(', ')}`);
    }
    if (tipoAlerta !== undefined && !CONTRATO.tiposAlerta.includes(tipoAlerta)) {
      errores.push(`alert_type debe ser uno de: ${CONTRATO.tiposAlerta.join(', ')}`);
    }
    if (errores.length) return errorDeValidacion(respuesta, errores);

    const parametros = [];
    const filtro = construirFiltros(
      { device_id: deviceId, severity, alert_type: tipoAlerta },
      parametros
    );
    parametros.push(limite);

    const { rows } = await db.query(
      `SELECT ${COLUMNAS_ALERTA} FROM alerts ${filtro} ` +
        `ORDER BY triggered_at DESC LIMIT $${parametros.length}`,
      parametros
    );
    respuesta.json({ data: rows, count: rows.length });
  })
);

app.use((peticion, respuesta) => {
  respuesta.status(404).json({
    error: 'not_found',
    message: `Ruta no encontrada: ${peticion.method} ${peticion.path}`,
  });
});

const ERRORES_POSTGRES = {
  23505: [409, 'conflict', 'El recurso ya existe'],
  23503: [422, 'unprocessable_entity', 'La referencia indicada no existe'],
  23514: [422, 'unprocessable_entity', 'El dato viola una restriccion del esquema'],
};

app.use((error, peticion, respuesta, siguiente) => {
  if (error.type === 'entity.parse.failed') {
    return respuesta.status(400).json({
      error: 'invalid_json',
      message: 'El cuerpo de la peticion no es JSON valido',
    });
  }

  const conocido = ERRORES_POSTGRES[error.code];
  if (conocido) {
    const [estado, codigo, mensaje] = conocido;
    return respuesta.status(estado).json({ error: codigo, message: mensaje });
  }

  if (process.env.NODE_ENV !== 'test') {
    console.error('Error no controlado:', error);
  }
  respuesta.status(500).json({
    error: 'internal_error',
    message: 'Error interno del servidor',
  });
});

module.exports = app;

if (require.main === module) {
  const puerto = Number(process.env.PORT) || 3000;
  app.listen(puerto, () => {
    console.log(`API CDRL escuchando en http://localhost:${puerto}`);
  });
}
