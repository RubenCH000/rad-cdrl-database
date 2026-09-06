'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  pool: { query: jest.fn(), end: jest.fn() },
}));

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const db = require('../src/config/database');
const app = require('../src/index');

const RAIZ = path.join(__dirname, '..');
const leerTexto = (relativa) => fs.readFileSync(path.join(RAIZ, relativa), 'utf8');
const leerJson = (relativa) => JSON.parse(leerTexto(relativa));

describe('Contrato: configuracion del proyecto', () => {
  const paquete = leerJson('package.json');

  test('package.json declara el punto de entrada y el script de pruebas', () => {
    expect(paquete.main).toBe('src/index.js');
    expect(paquete.scripts.test).toContain('jest');
    expect(paquete.scripts.start).toContain('src/index.js');
  });

  test('package.json declara el stack acordado en el ADR-001', () => {
    expect(Object.keys(paquete.dependencies)).toEqual(
      expect.arrayContaining(['express', 'pg', 'dotenv'])
    );
    expect(Object.keys(paquete.devDependencies)).toEqual(
      expect.arrayContaining(['jest', 'supertest'])
    );
  });

  test('package.json exige Node 18 o superior', () => {
    expect(paquete.engines.node).toMatch(/>=\s*18/);
  });

  test('jest esta configurado para descubrir las pruebas de tests/', () => {
    expect(paquete.jest.testEnvironment).toBe('node');
    expect(paquete.jest.testMatch.join(' ')).toContain('tests');
  });

  test('.env.example documenta las variables que consume la aplicacion', () => {
    const ejemplo = leerTexto('.env.example');
    const variables = [
      'PORT',
      'DB_HOST',
      'DB_PORT',
      'DB_NAME',
      'DB_USER',
      'DB_PASSWORD',
      'POSTGRES_DB',
      'POSTGRES_USER',
    ];
    variables.forEach((variable) => {
      expect(ejemplo).toMatch(new RegExp(`^${variable}=`, 'm'));
    });
  });

  test('el .env real nunca se versiona', () => {
    expect(leerTexto('.gitignore')).toMatch(/^\.env$/m);
  });

  test('los archivos del hito M01 siguen presentes', () => {
    const requeridos = [
      'Makefile',
      'docker-compose.yml',
      'src/index.js',
      'src/config/database.js',
      'db/migrations/001_initial_schema.sql',
      'db/seed/seed_data.sql',
      'scripts/run_migrations.js',
      'scripts/seed_data.js',
      'scripts/verify_base.sh',
      'docs/ADR-000-starter-base.md',
      'docs/ADR-001-data-contract.md',
      'evidence/m01-data-contract.json',
      '.github/workflows/cdrl-feedback.yml',
    ];
    requeridos.forEach((archivo) => {
      expect(fs.existsSync(path.join(RAIZ, archivo))).toBe(true);
    });
  });
});

describe('Contrato: las validaciones de la API son las documentadas', () => {
  const documentado = leerJson('evidence/m01-data-contract.json');
  const aplicado = app.locals.contrato;

  test('los rangos numericos coinciden con evidence/m01-data-contract.json', () => {
    expect(aplicado.rangos.temperature).toEqual(documentado.validations.temperature_range);
    expect(aplicado.rangos.humidity).toEqual(documentado.validations.humidity_range);
    expect(aplicado.rangos.battery_level).toEqual(documentado.validations.battery_range);
  });

  test('los catalogos de estado, severidad y tipo coinciden con el contrato', () => {
    expect(aplicado.estadosDispositivo).toEqual(documentado.validations.device_status);
    expect(aplicado.severidadesAlerta).toEqual(documentado.validations.alert_severity);
    expect(aplicado.tiposAlerta).toEqual(documentado.validations.alert_types);
  });

  test('la longitud minima de serial_number coincide con el CHECK de la migracion', () => {
    expect(leerTexto('db/migrations/001_initial_schema.sql')).toMatch(
      /LENGTH\(serial_number\)\s*>=\s*5/
    );
    expect(aplicado.longitudMinimaSerie).toBe(5);
  });

  test('la API consulta las tres tablas declaradas en el contrato', () => {
    const fuente = leerTexto('src/index.js');
    const tablas = documentado.tables.map((tabla) => tabla.name);
    expect(tablas).toEqual(['devices', 'telemetry_data', 'alerts']);
    tablas.forEach((tabla) => expect(fuente).toContain(tabla));
  });
});

describe('Contrato: superficie HTTP', () => {
  beforeEach(() => {
    db.query.mockReset();
    db.query.mockResolvedValue({ rows: [] });
  });

  test('el modulo exporta la app sin levantar el servidor', () => {
    expect(typeof app).toBe('function');
    expect(typeof app.listen).toBe('function');
  });

  test.each([
    ['/health'],
    ['/ready'],
    ['/api/devices'],
    ['/api/telemetry'],
    ['/api/alerts'],
  ])('GET %s esta publicado y responde JSON', async (endpoint) => {
    const respuesta = await request(app).get(endpoint);
    expect(respuesta.status).not.toBe(404);
    expect(respuesta.headers['content-type']).toMatch(/application\/json/);
  });

  test.each([
    ['/api/devices'],
    ['/api/telemetry'],
    ['/api/alerts'],
  ])('la coleccion %s responde con la forma { data, count }', async (endpoint) => {
    const respuesta = await request(app).get(endpoint);
    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual({ data: [], count: 0 });
  });

  test('los errores responden con la forma { error, message }', async () => {
    const respuesta = await request(app).get('/api/ruta-inexistente');
    expect(respuesta.status).toBe(404);
    expect(respuesta.body.error).toBe('not_found');
    expect(typeof respuesta.body.message).toBe('string');
  });

  test('las consultas a la base siempre son parametrizadas', async () => {
    await request(app).get('/api/telemetry?device_id=11111111-1111-4111-8111-111111111111');
    const [sql, parametros] = db.query.mock.calls[0];
    expect(sql).toContain('$1');
    expect(Array.isArray(parametros)).toBe(true);
    expect(sql).not.toContain('11111111-1111-4111-8111-111111111111');
  });
});
