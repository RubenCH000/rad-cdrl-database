# ADR-001: Contrato de Datos de Telemetría

**Fecha:** 2026-02-15
**Estado:** Aceptado
**Decisión tomada por:** Equipo RAD
**Autor principal:** Ruben

## Contexto

Basado en el ADR-000, la base inicial es reproducible pero carece de esquema y pruebas. Para el hito M01, necesitamos definir un contrato de datos que especifique las tablas, relaciones y validaciones para almacenar telemetría de dispositivos IoT.

## Decisión

Usar **PostgreSQL 16** como motor relacional (compatible con AWS RDS y Docker).

### Esquema de Datos

Definir 3 tablas principales:

1. **`devices`**: Registro de dispositivos IoT
   - Identificador único UUID
   - Número de serie único
   - Tipo de dispositivo
   - Estado (active, inactive, maintenance)

2. **`telemetry_data`**: Lecturas de telemetría
   - Relación con devices
   - Timestamp con zona horaria
   - Métricas: temperatura, humedad, batería
   - Metadata JSONB flexible

3. **`alerts`**: Alertas generadas por anomalías
   - Relación con devices
   - Tipo y severidad de alerta
   - Mensaje descriptivo
   - Timestamps de creación y resolución

### Stack Tecnológico

- **Backend**: Node.js 18+ con Express
- **Base de datos**: PostgreSQL 16
- **Testing**: Jest
- **ORM/Driver**: pg (node-postgres)

## Alternativas Consideradas

| Alternativa | Descripción | Motivo de descarte |
|------------|-------------|-------------------|
| DynamoDB | NoSQL de AWS | Relaciones complejas y costo elevado |
| MongoDB | NoSQL documental | Falta de integridad referencial nativa |
| MySQL | Relacional | PostgreSQL tiene mejor soporte JSONB |

## Consecuencias

### Positivas
- Escalable con particiones por tiempo (opcional)
- Compatible con entorno local y AWS Academy
- Integridad referencial garantizada
- Soporte para datos JSON en columnas específicas

### Negativas
- Requiere mantenimiento de migraciones
- Overhead de conexiones para datos de alta frecuencia

### Riesgos
- Crecimiento de datos requiere estrategia de particionamiento
- Latencia en consultas si no se indexa correctamente

## Referencias
- ADR-000: Starter Base
- AWS RDS PostgreSQL Documentation
