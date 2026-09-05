-- Migración 001: Esquema inicial de telemetría
-- Autor: Ruben
-- Compatible con PostgreSQL 16, AWS RDS y Docker

BEGIN;

-- Extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Tabla de dispositivos
CREATE TABLE IF NOT EXISTS devices (
    device_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    serial_number VARCHAR(100) UNIQUE NOT NULL,
    device_type VARCHAR(50) NOT NULL,
    firmware_version VARCHAR(20),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_device_status 
        CHECK (status IN ('active', 'inactive', 'maintenance')),
    CONSTRAINT chk_serial_number_length 
        CHECK (LENGTH(serial_number) >= 5)
);

-- Tabla de datos de telemetría
CREATE TABLE IF NOT EXISTS telemetry_data (
    telemetry_id BIGSERIAL PRIMARY KEY,
    device_id UUID NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    temperature DECIMAL(5,2),
    humidity DECIMAL(5,2),
    battery_level INTEGER,
    metadata JSONB DEFAULT '{}',
    CONSTRAINT fk_telemetry_device 
        FOREIGN KEY (device_id) 
        REFERENCES devices(device_id) 
        ON DELETE CASCADE,
    CONSTRAINT chk_temperature_range 
        CHECK (temperature IS NULL OR (temperature BETWEEN -50 AND 100)),
    CONSTRAINT chk_humidity_range 
        CHECK (humidity IS NULL OR (humidity BETWEEN 0 AND 100)),
    CONSTRAINT chk_battery_range 
        CHECK (battery_level IS NULL OR (battery_level BETWEEN 0 AND 100)),
    CONSTRAINT chk_timestamp_not_future 
        CHECK (timestamp <= NOW() + INTERVAL '1 minute')
);

-- Tabla de alertas
CREATE TABLE IF NOT EXISTS alerts (
    alert_id BIGSERIAL PRIMARY KEY,
    device_id UUID NOT NULL,
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    triggered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT fk_alerts_device 
        FOREIGN KEY (device_id) 
        REFERENCES devices(device_id) 
        ON DELETE CASCADE,
    CONSTRAINT chk_alert_severity 
        CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    CONSTRAINT chk_alert_type 
        CHECK (alert_type IN ('temperature', 'humidity', 'battery', 'connection')),
    CONSTRAINT chk_resolved_after_triggered 
        CHECK (resolved_at IS NULL OR resolved_at >= triggered_at)
);

-- Índices para optimizar consultas comunes
CREATE INDEX IF NOT EXISTS idx_devices_serial ON devices(serial_number);
CREATE INDEX IF NOT EXISTS idx_telemetry_device_time 
    ON telemetry_data(device_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp 
    ON telemetry_data(timestamp);
CREATE INDEX IF NOT EXISTS idx_alerts_device_time 
    ON alerts(device_id, triggered_at);
CREATE INDEX IF NOT EXISTS idx_alerts_unresolved 
    ON alerts(alert_type) 
    WHERE resolved_at IS NULL;

COMMIT;
