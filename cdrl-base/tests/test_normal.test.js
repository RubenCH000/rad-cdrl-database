'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  pool: { query: jest.fn(), end: jest.fn() },
}));

const request = require('supertest');
const db = require('../src/config/database');
const app = require('../src/index');

const ID_DISPOSITIVO = '11111111-1111-4111-8111-111111111111';

const DISPOSITIVO = {
  device_id: ID_DISPOSITIVO,
  serial_number: 'SN-000123',
  device_type: 'sensor',
  firmware_version: '1.4.2',
  status: 'active',
  created_at: '2026-02-15T10:00:00.000Z',
};

const LECTURA = {
  telemetry_id: 1,
  device_id: ID_DISPOSITIVO,
  timestamp: '2026-02-15T10:05:00.000Z',
  temperature: 22.5,
  humidity: 48.1,
  battery_level: 87,
  metadata: { origen: 'seed' },
};

const ALERTA = {
  alert_id: 1,
  device_id: ID_DISPOSITIVO,
  alert_type: 'temperature',
  severity: 'high',
  message: 'Temperatura sobre el umbral',
  triggered_at: '2026-02-15T10:06:00.000Z',
  resolved_at: null,
};

beforeEach(() => {
  db.query.mockReset();
});

describe('Sondas de salud', () => {
  test('GET /health responde 200 sin consultar la base', async () => {
    const respuesta = await request(app).get('/health');

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.status).toBe('ok');
    expect(respuesta.body.service).toBe('cdrl-api');
    expect(Number.isNaN(Date.parse(respuesta.body.timestamp))).toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('GET /ready responde 200 cuando la base contesta', async () => {
    db.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const respuesta = await request(app).get('/ready');

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual({ status: 'ready', database: 'up' });
    expect(db.query).toHaveBeenCalledWith('SELECT 1');
  });
});

describe('GET /api/devices', () => {
  test('devuelve la lista de dispositivos con su conteo', async () => {
    db.query.mockResolvedValue({ rows: [DISPOSITIVO] });

    const respuesta = await request(app).get('/api/devices');

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.count).toBe(1);
    expect(respuesta.body.data[0]).toEqual(DISPOSITIVO);
  });

  test('aplica el limite por defecto de 50 registros', async () => {
    db.query.mockResolvedValue({ rows: [] });

    await request(app).get('/api/devices');

    const [, parametros] = db.query.mock.calls[0];
    expect(parametros).toEqual([50]);
  });

  test('respeta el limite indicado por el cliente', async () => {
    db.query.mockResolvedValue({ rows: [] });

    await request(app).get('/api/devices?limit=10');

    const [, parametros] = db.query.mock.calls[0];
    expect(parametros).toEqual([10]);
  });

  test('filtra por estado cuando se pide', async () => {
    db.query.mockResolvedValue({ rows: [DISPOSITIVO] });

    const respuesta = await request(app).get('/api/devices?status=active');

    const [sql, parametros] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE status = $1');
    expect(parametros).toEqual(['active', 50]);
    expect(respuesta.status).toBe(200);
  });
});

describe('GET /api/devices/:deviceId', () => {
  test('devuelve el dispositivo solicitado', async () => {
    db.query.mockResolvedValue({ rows: [DISPOSITIVO] });

    const respuesta = await request(app).get(`/api/devices/${ID_DISPOSITIVO}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.data).toEqual(DISPOSITIVO);
    const [, parametros] = db.query.mock.calls[0];
    expect(parametros).toEqual([ID_DISPOSITIVO]);
  });
});

describe('POST /api/devices', () => {
  test('registra un dispositivo y responde 201 con el recurso creado', async () => {
    db.query.mockResolvedValue({ rows: [DISPOSITIVO] });

    const respuesta = await request(app).post('/api/devices').send({
      serial_number: 'SN-000123',
      device_type: 'sensor',
      firmware_version: '1.4.2',
      status: 'active',
    });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.data).toEqual(DISPOSITIVO);

    const [sql, parametros] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO devices');
    expect(parametros).toEqual(['SN-000123', 'sensor', '1.4.2', 'active']);
  });

  test('usa el estado "active" por defecto cuando no se envia', async () => {
    db.query.mockResolvedValue({ rows: [DISPOSITIVO] });

    await request(app)
      .post('/api/devices')
      .send({ serial_number: 'SN-000999', device_type: 'gateway' });

    const [, parametros] = db.query.mock.calls[0];
    expect(parametros).toEqual(['SN-000999', 'gateway', null, 'active']);
  });
});

describe('GET /api/telemetry', () => {
  test('devuelve las lecturas con su conteo', async () => {
    db.query.mockResolvedValue({ rows: [LECTURA] });

    const respuesta = await request(app).get('/api/telemetry');

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.count).toBe(1);
    expect(respuesta.body.data[0].metadata).toEqual({ origen: 'seed' });
  });

  test('filtra por dispositivo y ordena por fecha descendente', async () => {
    db.query.mockResolvedValue({ rows: [LECTURA] });

    const respuesta = await request(app).get(`/api/telemetry?device_id=${ID_DISPOSITIVO}&limit=5`);

    const [sql, parametros] = db.query.mock.calls[0];
    expect(sql).toContain('FROM telemetry_data');
    expect(sql).toContain('WHERE device_id = $1');
    expect(sql).toContain('ORDER BY timestamp DESC');
    expect(parametros).toEqual([ID_DISPOSITIVO, 5]);
    expect(respuesta.status).toBe(200);
  });
});

describe('POST /api/telemetry', () => {
  test('registra una lectura completa y responde 201', async () => {
    db.query.mockResolvedValue({ rows: [LECTURA] });

    const respuesta = await request(app).post('/api/telemetry').send({
      device_id: ID_DISPOSITIVO,
      timestamp: '2026-02-15T10:05:00.000Z',
      temperature: 22.5,
      humidity: 48.1,
      battery_level: 87,
      metadata: { origen: 'seed' },
    });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.data).toEqual(LECTURA);

    const [sql, parametros] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO telemetry_data');
    expect(parametros).toEqual([
      ID_DISPOSITIVO,
      '2026-02-15T10:05:00.000Z',
      22.5,
      48.1,
      87,
      { origen: 'seed' },
    ]);
  });

  test('rellena timestamp y metadata cuando no se envian', async () => {
    db.query.mockResolvedValue({ rows: [LECTURA] });

    await request(app).post('/api/telemetry').send({
      device_id: ID_DISPOSITIVO,
      temperature: 21,
    });

    const [, parametros] = db.query.mock.calls[0];
    const [, marcaTiempo, , , , metadata] = parametros;
    expect(Number.isNaN(Date.parse(marcaTiempo))).toBe(false);
    expect(metadata).toEqual({});
  });
});

describe('GET /api/alerts', () => {
  test('devuelve las alertas con su conteo', async () => {
    db.query.mockResolvedValue({ rows: [ALERTA] });

    const respuesta = await request(app).get('/api/alerts');

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.count).toBe(1);
    expect(respuesta.body.data[0].severity).toBe('high');
  });

  test('combina los filtros de severidad y tipo', async () => {
    db.query.mockResolvedValue({ rows: [ALERTA] });

    await request(app).get('/api/alerts?severity=high&alert_type=temperature');

    const [sql, parametros] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE severity = $1 AND alert_type = $2');
    expect(parametros).toEqual(['high', 'temperature', 50]);
  });
});
