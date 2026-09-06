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

beforeEach(() => {
  db.query.mockReset();
  db.query.mockResolvedValue({ rows: [{ telemetry_id: 1 }] });
});

describe('Extremos exactos de los rangos numericos', () => {
  test.each([
    ['temperature', -50],
    ['temperature', 100],
    ['humidity', 0],
    ['humidity', 100],
    ['battery_level', 0],
    ['battery_level', 100],
  ])('acepta %s = %p por estar dentro del limite', async (campo, valor) => {
    const respuesta = await request(app)
      .post('/api/telemetry')
      .send({ ...LECTURA_BASE, [campo]: valor });

    expect(respuesta.status).toBe(201);
  });

  test('el cero se guarda como cero y no como valor ausente', async () => {
    await request(app)
      .post('/api/telemetry')
      .send({ ...LECTURA_BASE, temperature: 0, humidity: 0, battery_level: 0 });

    const [, parametros] = db.query.mock.calls[0];
    const [, , temperatura, humedad, bateria] = parametros;
    expect(temperatura).toBe(0);
    expect(humedad).toBe(0);
    expect(bateria).toBe(0);
  });

  test('acepta temperaturas negativas y decimales dentro del rango', async () => {
    const respuesta = await request(app)
      .post('/api/telemetry')
      .send({ ...LECTURA_BASE, temperature: -49.99 });

    expect(respuesta.status).toBe(201);
  });

  test('las metricas opcionales omitidas viajan como NULL a la base', async () => {
    await request(app).post('/api/telemetry').send(LECTURA_BASE);

    const [, parametros] = db.query.mock.calls[0];
    const [, , temperatura, humedad, bateria] = parametros;
    expect(temperatura).toBeNull();
    expect(humedad).toBeNull();
    expect(bateria).toBeNull();
  });

  test('un null explicito tambien viaja como NULL', async () => {
    await request(app)
      .post('/api/telemetry')
      .send({ ...LECTURA_BASE, temperature: null, humidity: null, battery_level: null });

    const [, parametros] = db.query.mock.calls[0];
    expect(parametros.slice(2, 5)).toEqual([null, null, null]);
  });
});

describe('Longitud minima de serial_number', () => {
  test('acepta exactamente 5 caracteres, el minimo del CHECK', async () => {
    db.query.mockResolvedValue({ rows: [{ device_id: ID_DISPOSITIVO }] });

    const respuesta = await request(app)
      .post('/api/devices')
      .send({ serial_number: 'SN-01', device_type: 'sensor' });

    expect(respuesta.status).toBe(201);
  });

  test('recorta espacios antes de medir la longitud', async () => {
    db.query.mockResolvedValue({ rows: [{ device_id: ID_DISPOSITIVO }] });

    const respuesta = await request(app)
      .post('/api/devices')
      .send({ serial_number: '  SN-01  ', device_type: '  sensor  ' });

    expect(respuesta.status).toBe(201);
    const [, parametros] = db.query.mock.calls[0];
    expect(parametros[0]).toBe('SN-01');
    expect(parametros[1]).toBe('sensor');
  });
});

describe('Limites de paginacion', () => {
  test.each([
    [1],
    [50],
    [500],
  ])('acepta limit=%i', async (limite) => {
    db.query.mockResolvedValue({ rows: [] });

    const respuesta = await request(app).get(`/api/devices?limit=${limite}`);

    expect(respuesta.status).toBe(200);
    const [, parametros] = db.query.mock.calls[0];
    expect(parametros).toEqual([limite]);
  });
});

describe('Colecciones vacias', () => {
  test.each([
    ['/api/devices'],
    ['/api/telemetry'],
    ['/api/alerts'],
  ])('%s devuelve 200 con data vacia, no 404', async (endpoint) => {
    db.query.mockResolvedValue({ rows: [] });

    const respuesta = await request(app).get(endpoint);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual({ data: [], count: 0 });
  });
});

describe('Formato de los identificadores', () => {
  test('acepta un UUID en mayusculas', async () => {
    db.query.mockResolvedValue({ rows: [{ device_id: ID_DISPOSITIVO }] });

    const respuesta = await request(app).get(`/api/devices/${ID_DISPOSITIVO.toUpperCase()}`);

    expect(respuesta.status).toBe(200);
  });

  test('acepta un UUID en mayusculas como filtro de telemetria', async () => {
    db.query.mockResolvedValue({ rows: [] });

    const respuesta = await request(app).get(
      `/api/telemetry?device_id=${ID_DISPOSITIVO.toUpperCase()}`
    );

    expect(respuesta.status).toBe(200);
  });
});

describe('Cuerpos poco habituales pero validos', () => {
  test('metadata vacia explicita se conserva', async () => {
    await request(app)
      .post('/api/telemetry')
      .send({ ...LECTURA_BASE, metadata: {} });

    const [, parametros] = db.query.mock.calls[0];
    expect(parametros[5]).toEqual({});
  });

  test('metadata anidada se envia tal cual', async () => {
    const metadata = { sensor: { modelo: 'X1', calibrado: true }, etiquetas: ['piso-2'] };

    await request(app)
      .post('/api/telemetry')
      .send({ ...LECTURA_BASE, metadata });

    const [, parametros] = db.query.mock.calls[0];
    expect(parametros[5]).toEqual(metadata);
  });

  test('los campos desconocidos se ignoran en lugar de romper la peticion', async () => {
    db.query.mockResolvedValue({ rows: [{ device_id: ID_DISPOSITIVO }] });

    const respuesta = await request(app).post('/api/devices').send({
      serial_number: 'SN-000123',
      device_type: 'sensor',
      campo_inventado: 'se ignora',
    });

    expect(respuesta.status).toBe(201);
    const [, parametros] = db.query.mock.calls[0];
    expect(parametros).toHaveLength(4);
  });

  test('los tres estados validos del contrato son aceptados', async () => {
    db.query.mockResolvedValue({ rows: [{ device_id: ID_DISPOSITIVO }] });

    for (const estado of app.locals.contrato.estadosDispositivo) {
      const respuesta = await request(app)
        .post('/api/devices')
        .send({ serial_number: 'SN-000123', device_type: 'sensor', status: estado });

      expect(respuesta.status).toBe(201);
    }
  });
});
