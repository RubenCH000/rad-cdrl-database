INSERT INTO telemetry (device_id, payload, recorded_at) VALUES
('sensor-01', '{"temperatura": 22.5, "estado": "activo"}', CURRENT_TIMESTAMP),
('sensor-02', '{"temperatura": 18.2, "estado": "inactivo"}', CURRENT_TIMESTAMP - INTERVAL '1 hour');