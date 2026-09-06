'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  pool: { query: jest.fn(), end: jest.fn() },
}));

const request = require('supertest');
const db = require('../src/config/database');
const app = require('../src/index');

const ID_DISPOSITIVO = '11111111-1111-4111-8111-111111111111';
const LECTURA_BASE = { device_id: ID_DISPOSITIVO, timestamp: '2026-02-15T10:05:00.000Z' };

function errorPostgres(codigo, mensaje) {
  const error = new Error(mensaje);
  error.code = codigo;
  return error;
}

beforeEach(() => {
  db.query.mockReset();
  db.query.mockResolvedValue({ rows: [] });
});

describe('Rutas y cuerpos mal formados', () => {
  test('una ruta inexistente responde 404', async () => {
    const respuesta = await request(app).get('/api/no-existe');

    expect(respuesta.status).toBe(404);
    expect(respuesta.body.error).toBe('not_found');
  });

  test('un metodo no publicado en una ruta existente responde 404', async () => {
    const respuesta = await request(app).delete('/api/devices');

    expect(respuesta.status).toBe(404);
    expect(respuesta.body.error).toBe('not_found');
  });

  test('un JSON mal formado responde 400 y no 500', async () => {
    const respuesta = await request(app)
      .post('/api/devices')
      .set('Content-Type', 'application/json')
      .send('{"serial_number": ');

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error).toBe('invalid_json');
  });

  test('un cuerpo vacio en POST responde 400 con el detalle de lo que falta', async () => {
    const respuesta = await request(app).post('/api/devices').send({});

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error).toBe('validation_error');
    expect(respuesta.body.details.length).toBeGreaterThan(0);
  });
});

describe('POST /api/devices con datos invalidos', () => {
  test.each([
    ['sin serial_number', { device_type: 'sensor' }],
    ['con serial_number de 4 caracteres', { serial_number: 'SN-0', device_type: 'sensor' }],
    ['con serial_number numerico', { serial_number: 12345, device_type: 'sensor' }],
    ['sin device_type', { serial_number: 'SN-000123' }],
    ['con device_type vacio', { serial_number: 'SN-000123', device_type: '   ' }],
    [
      'con un status fuera del catalogo',
      { serial_number: 'SN-000123', device_type: 'sensor', status: 'encendido' },
    ],
  ])('rechaza el alta %s', async (caso, cuerpo) => {
    const respuesta = await request(app).post('/api/devices').send(cuerpo);

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error).toBe('validation_error');
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('POST /api/telemetry con datos fuera del contrato', () => {
  test.each([
    ['temperatura por encima del maximo', { temperature: 100.01 }],
    ['temperatura por debajo del minimo', { temperature: -50.01 }],
    ['humedad por encima del maximo', { humidity: 101 }],
    ['humedad negativa', { humidity: -1 }],
    ['bateria por encima del maximo', { battery_level: 101 }],
    ['bateria negativa', { battery_level: -1 }],
    ['bateria decimal', { battery_level: 87.5 }],
    ['temperatura como texto', { temperature: '22.5' }],
    ['metadata como arreglo', { metadata: [1, 2, 3] }],
    ['metadata como texto', { metadata: 'origen=seed' }],
  ])('rechaza la lectura con %s', async (caso, campos) => {
    const respuesta = await request(app)
      .post('/api/telemetry')
      .send({ ...LECTURA_BASE, ...campos });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error).toBe('validation_error');
    expect(db.query).not.toHaveBeenCalled();
  });

  test('rechaza la lectura sin device_id', async () => {
    const respuesta = await request(app).post('/api/telemetry').send({ temperature: 22.5 });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.details.join(' ')).toContain('device_id');
  });

  test('rechaza un device_id que no es UUID', async () => {
    const respuesta = await request(app)
      .post('/api/telemetry')
      .send({ ...LECTURA_BASE, device_id: 'sensor-01' });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.details.join(' ')).toContain('device_id');
  });

  test('rechaza un timestamp que no es una fecha', async () => {
    const respuesta = await request(app)
      .post('/api/telemetry')
      .send({ ...LECTURA_BASE, timestamp: 'ayer por la tarde' });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.details.join(' ')).toContain('timestamp');
  });

  test('acumula todos los errores en una sola respuesta', async () => {
    const respuesta = await request(app).post('/api/telemetry').send({
      device_id: 'no-es-uuid',
      temperature: 500,
      humidity: -20,
    });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.details.length).toBe(3);
  });
});

describe('Parametros de consulta invalidos', () => {
  test.each([
    ['/api/devices?limit=0'],
    ['/api/devices?limit=501'],
    ['/api/devices?limit=abc'],
    ['/api/devices?limit=1.5'],
    ['/api/devices?limit=-3'],
    ['/api/devices?status=encendido'],
    ['/api/telemetry?device_id=sensor-01'],
    ['/api/alerts?severity=urgente'],
    ['/api/alerts?alert_type=humo'],
  ])('rechaza %s con 400 sin tocar la base', async (endpoint) => {
    const respuesta = await request(app).get(endpoint);

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error).toBe('validation_error');
    expect(db.query).not.toHaveBeenCalled();
  });

  test('rechaza un device_id mal formado en la ruta de detalle', async () => {
    const respuesta = await request(app).get('/api/devices/123');

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error).toBe('validation_error');
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('Recursos inexistentes', () => {
  test('un dispositivo que no esta en la base responde 404', async () => {
    db.query.mockResolvedValue({ rows: [] });

    const respuesta = await request(app).get(`/api/devices/${ID_DISPOSITIVO}`);

    expect(respuesta.status).toBe(404);
    expect(respuesta.body.error).toBe('not_found');
  });
});

describe('Fallos de la base de datos', () => {
  test('GET /ready responde 503 cuando PostgreSQL no contesta', async () => {
    db.query.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'));

    const respuesta = await request(app).get('/ready');

    expect(respuesta.status).toBe(503);
    expect(respuesta.body.database).toBe('down');
  });

  test('un fallo inesperado de la base responde 500 sin filtrar el detalle interno', async () => {
    db.query.mockRejectedValue(new Error('relation "devices" does not exist'));

    const respuesta = await request(app).get('/api/devices');

    expect(respuesta.status).toBe(500);
    expect(respuesta.body).toEqual({
      error: 'internal_error',
      message: 'Error interno del servidor',
    });
    expect(JSON.stringify(respuesta.body)).not.toContain('relation');
  });

  test('un serial_number duplicado responde 409', async () => {
    db.query.mockRejectedValue(
      errorPostgres('23505', 'duplicate key value violates unique constraint')
    );

    const respuesta = await request(app)
      .post('/api/devices')
      .send({ serial_number: 'SN-000123', device_type: 'sensor' });

    expect(respuesta.status).toBe(409);
    expect(respuesta.body.error).toBe('conflict');
  });

  test('una lectura de un dispositivo inexistente responde 422 por la llave foranea', async () => {
    db.query.mockRejectedValue(
      errorPostgres('23503', 'insert or update on table "telemetry_data" violates foreign key')
    );

    const respuesta = await request(app)
      .post('/api/telemetry')
      .send({ ...LECTURA_BASE, temperature: 22.5 });

    expect(respuesta.status).toBe(422);
    expect(respuesta.body.error).toBe('unprocessable_entity');
  });

  test('una violacion de CHECK en la base responde 422', async () => {
    db.query.mockRejectedValue(
      errorPostgres('23514', 'new row violates check constraint "chk_temperature_range"')
    );

    const respuesta = await request(app)
      .post('/api/telemetry')
      .send({ ...LECTURA_BASE, temperature: 22.5 });

    expect(respuesta.status).toBe(422);
  });

  test('la API sigue respondiendo despues de un error de la base', async () => {
    db.query.mockRejectedValueOnce(new Error('fallo transitorio'));
    const fallida = await request(app).get('/api/devices');
    expect(fallida.status).toBe(500);

    db.query.mockResolvedValue({ rows: [] });
    const siguiente = await request(app).get('/api/devices');
    expect(siguiente.status).toBe(200);
  });
});
